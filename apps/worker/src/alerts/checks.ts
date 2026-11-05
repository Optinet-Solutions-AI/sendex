import {
  type AlertPayloadInput,
  formatEur,
  hourKeyUtc,
  shouldAlertLowBalance,
  spikeDecision,
} from "@sendex/core";
import {
  type Db,
  getBalanceMicro,
  getSettings,
  markLowBalanceAlerted,
  organisationsWithLowBalanceRule,
  organisationsWithRecentSends,
  type RaiseAlertResult,
  raiseAlert,
  type SendRate,
  sendRate,
} from "@sendex/db";
import type { Logger } from "../log.js";

/**
 * Organisation checks run from the scheduler tick (D3-11): the sending spike rule and the
 * low balance rule. Each organisation is looked at at most once per `SPIKE_CHECK_EVERY_MS`
 * (a Redis `SET NX PX` key, so several worker processes share the budget) and an alert is
 * stored at most once per UTC hour (`raiseAlert` is idempotent per period). Email delivery
 * of the alerts is a later card; today an alert is a row, an audit entry and a log line.
 */

export const SPIKE_CHECK_EVERY_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;

export interface LowBalanceRule {
  lowBalanceThresholdMicro: bigint | null;
  lowBalanceAlertedAt: Date | null;
  lowBalanceEmails: string[];
}

/** What the checks read and write, composed from `packages/db` helpers; faked in tests. */
export interface AlertChecksStore {
  organisationsWithRecentSends(since: Date): Promise<string[]>;
  organisationsWithLowBalanceRule(): Promise<string[]>;
  sendRate(organisationId: string, now: Date): Promise<SendRate>;
  getBalanceMicro(organisationId: string): Promise<bigint>;
  getLowBalanceRule(organisationId: string): Promise<LowBalanceRule>;
  markLowBalanceAlerted(organisationId: string, at: Date | null): Promise<void>;
  raiseAlert(organisationId: string, payload: AlertPayloadInput): Promise<RaiseAlertResult>;
}

export function createAlertChecksStore(db: Db): AlertChecksStore {
  return {
    organisationsWithRecentSends: (since) => organisationsWithRecentSends(db, since),
    organisationsWithLowBalanceRule: () => organisationsWithLowBalanceRule(db),
    sendRate: (organisationId, now) => sendRate(db, organisationId, now),
    getBalanceMicro: (organisationId) => getBalanceMicro(db, organisationId),
    async getLowBalanceRule(organisationId) {
      const s = await getSettings(db, organisationId);
      return {
        lowBalanceThresholdMicro: s.lowBalanceThresholdMicro,
        lowBalanceAlertedAt: s.lowBalanceAlertedAt,
        lowBalanceEmails: s.lowBalanceEmails,
      };
    },
    markLowBalanceAlerted: (organisationId, at) => markLowBalanceAlerted(db, organisationId, at),
    raiseAlert: (organisationId, payload) => raiseAlert(db, organisationId, payload),
  };
}

/** "May this process run the check behind `key` now?" True at most once per `ttlMs`. */
export interface CheckThrottle {
  tryAcquire(key: string, ttlMs: number): Promise<boolean>;
}

/** The slice of ioredis the throttle needs: `SET key value PX ttl NX`. */
export interface ThrottleRedis {
  set(key: string, value: string, px: "PX", ttlMs: number, nx: "NX"): Promise<"OK" | null>;
}

export function createRedisThrottle(redis: ThrottleRedis): CheckThrottle {
  return {
    async tryAcquire(key, ttlMs) {
      return (await redis.set(key, "1", "PX", ttlMs, "NX")) === "OK";
    },
  };
}

export const throttleKeys = {
  spike: (organisationId: string) => `sendex:alerts:spike:${organisationId}`,
  balance: (organisationId: string) => `sendex:alerts:balance:${organisationId}`,
};

export interface AlertChecksDeps {
  store: AlertChecksStore;
  throttle: CheckThrottle;
  log: Logger;
  now?: () => Date;
  /** How often one organisation is checked. Default 5 minutes. */
  everyMs?: number;
}

export interface AlertChecksResult {
  spikeChecked: number;
  spikesRaised: number;
  balanceChecked: number;
  lowBalanceRaised: number;
  rearmed: number;
}

const grouped = new Intl.NumberFormat("en-GB");

function spikeMessage(rate: SendRate, ratio: number): string {
  const lastHour = grouped.format(rate.lastHour);
  if (!Number.isFinite(ratio)) {
    return `Sending spike: ${lastHour} messages in the last hour, with no sends in the seven days before.`;
  }
  const average = grouped.format(Math.round(rate.sevenDayHourlyAverage * 10) / 10);
  const times = grouped.format(Math.round(ratio * 10) / 10);
  return `Sending spike: ${lastHour} messages in the last hour, ${times}x the seven-day hourly average of ${average}.`;
}

async function checkSpike(deps: AlertChecksDeps, organisationId: string, now: Date) {
  const rate = await deps.store.sendRate(organisationId, now);
  const decision = spikeDecision(rate);
  if (!decision.spike) return false;
  const ratio = Number.isFinite(decision.ratio) ? decision.ratio : null;
  const { created } = await deps.store.raiseAlert(organisationId, {
    kind: "send_spike",
    periodKey: hourKeyUtc(now),
    message: spikeMessage(rate, decision.ratio),
    details: { lastHour: rate.lastHour, sevenDayHourlyAverage: rate.sevenDayHourlyAverage, ratio },
  });
  if (created) {
    deps.log("warn", "sending spike alert raised", {
      organisationId,
      lastHour: rate.lastHour,
      sevenDayHourlyAverage: rate.sevenDayHourlyAverage,
      ratio,
    });
  }
  return created;
}

async function checkLowBalance(
  deps: AlertChecksDeps,
  organisationId: string,
  now: Date,
): Promise<"alert" | "rearm" | "none"> {
  const [rule, balanceMicro] = await Promise.all([
    deps.store.getLowBalanceRule(organisationId),
    deps.store.getBalanceMicro(organisationId),
  ]);
  const decision = shouldAlertLowBalance({
    balanceMicro,
    thresholdMicro: rule.lowBalanceThresholdMicro,
    alertedAt: rule.lowBalanceAlertedAt,
    now,
  });
  if (decision.action === "rearm") {
    await deps.store.markLowBalanceAlerted(organisationId, null);
    deps.log("info", "low balance alert rearmed", { organisationId });
    return "rearm";
  }
  if (decision.action !== "alert") return "none";
  const threshold = rule.lowBalanceThresholdMicro ?? 0n;
  await deps.store.raiseAlert(organisationId, {
    kind: "low_balance",
    periodKey: hourKeyUtc(now),
    message: `Balance ${formatEur(balanceMicro)} is below the low balance threshold of ${formatEur(threshold)}.`,
    details: {
      balanceMicro: balanceMicro.toString(),
      thresholdMicro: threshold.toString(),
      recipients: rule.lowBalanceEmails.length,
    },
  });
  await deps.store.markLowBalanceAlerted(organisationId, decision.alertedAt);
  deps.log("warn", "low balance alert raised", {
    organisationId,
    balanceMicro: balanceMicro.toString(),
    thresholdMicro: threshold.toString(),
    recipients: rule.lowBalanceEmails.length,
  });
  return "alert";
}

/** One pass over every organisation due for a check. A failing organisation is logged and skipped. */
export async function runAlertChecks(deps: AlertChecksDeps): Promise<AlertChecksResult> {
  const now = deps.now?.() ?? new Date();
  const everyMs = deps.everyMs ?? SPIKE_CHECK_EVERY_MS;
  const result: AlertChecksResult = {
    spikeChecked: 0,
    spikesRaised: 0,
    balanceChecked: 0,
    lowBalanceRaised: 0,
    rearmed: 0,
  };

  for (const organisationId of await deps.store.organisationsWithRecentSends(
    new Date(now.getTime() - HOUR_MS),
  )) {
    if (!(await deps.throttle.tryAcquire(throttleKeys.spike(organisationId), everyMs))) continue;
    result.spikeChecked += 1;
    try {
      if (await checkSpike(deps, organisationId, now)) result.spikesRaised += 1;
    } catch (err) {
      deps.log("error", "spike check failed", { organisationId, err });
    }
  }

  for (const organisationId of await deps.store.organisationsWithLowBalanceRule()) {
    if (!(await deps.throttle.tryAcquire(throttleKeys.balance(organisationId), everyMs))) continue;
    result.balanceChecked += 1;
    try {
      const outcome = await checkLowBalance(deps, organisationId, now);
      if (outcome === "alert") result.lowBalanceRaised += 1;
      if (outcome === "rearm") result.rearmed += 1;
    } catch (err) {
      deps.log("error", "low balance check failed", { organisationId, err });
    }
  }
  return result;
}
