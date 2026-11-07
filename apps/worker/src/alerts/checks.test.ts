import type { SendRate } from "@sendex/db";
import { describe, expect, it } from "vitest";
import { createLogger } from "../log.js";
import { createFakeCapsStore, type FakeCapsStore } from "../send/caps.fake.js";
import {
  type AlertChecksStore,
  type CheckThrottle,
  createRedisThrottle,
  runAlertChecks,
  SPIKE_CHECK_EVERY_MS,
} from "./checks.js";

const quiet = createLogger({ write: () => undefined });
const NOW = new Date("2026-11-06T13:30:00Z");

interface FakeOrg {
  rate: SendRate;
  balanceMicro: bigint;
  thresholdMicro: bigint | null;
  alertedAt: Date | null;
  emails: string[];
}

function fakeStore(orgs: Record<string, FakeOrg>, caps: FakeCapsStore) {
  const marks: Array<{ organisationId: string; at: Date | null }> = [];
  const store: AlertChecksStore = {
    async organisationsWithRecentSends() {
      return Object.entries(orgs)
        .filter(([, o]) => o.rate.lastHour > 0)
        .map(([id]) => id);
    },
    async organisationsWithLowBalanceRule() {
      return Object.entries(orgs)
        .filter(([, o]) => o.thresholdMicro !== null || o.alertedAt !== null)
        .map(([id]) => id);
    },
    async sendRate(organisationId) {
      const o = orgs[organisationId];
      if (!o) throw new Error("unknown org");
      return o.rate;
    },
    async getBalanceMicro(organisationId) {
      return orgs[organisationId]?.balanceMicro ?? 0n;
    },
    async getLowBalanceRule(organisationId) {
      const o = orgs[organisationId];
      if (!o) throw new Error("unknown org");
      return {
        lowBalanceThresholdMicro: o.thresholdMicro,
        lowBalanceAlertedAt: o.alertedAt,
        lowBalanceEmails: o.emails,
      };
    },
    async markLowBalanceAlerted(organisationId, at) {
      marks.push({ organisationId, at });
      const o = orgs[organisationId];
      if (o) o.alertedAt = at;
    },
    raiseAlert: (organisationId, payload) => caps.raiseAlert(organisationId, payload),
  };
  return { store, marks };
}

/** In-memory throttle keyed like Redis `SET NX PX`, with a clock the test moves. */
function fakeThrottle(clock: { now: number }): CheckThrottle & { keys: Map<string, number> } {
  const keys = new Map<string, number>();
  return {
    keys,
    async tryAcquire(key, ttlMs) {
      const until = keys.get(key);
      if (until !== undefined && until > clock.now) return false;
      keys.set(key, clock.now + ttlMs);
      return true;
    },
  };
}

describe("runAlertChecks", () => {
  it("raises a spike alert once per hour when the last hour is over 5x the weekly average", async () => {
    const caps = createFakeCapsStore();
    const { store } = fakeStore(
      {
        "org-spike": {
          rate: { lastHour: 1_200, sevenDayHourlyAverage: 200 },
          balanceMicro: 0n,
          thresholdMicro: null,
          alertedAt: null,
          emails: [],
        },
        "org-calm": {
          rate: { lastHour: 300, sevenDayHourlyAverage: 200 },
          balanceMicro: 0n,
          thresholdMicro: null,
          alertedAt: null,
          emails: [],
        },
      },
      caps,
    );
    const clock = { now: NOW.getTime() };
    const throttle = fakeThrottle(clock);
    const result = await runAlertChecks({
      store,
      throttle,
      log: quiet,
      now: () => new Date(clock.now),
    });
    expect(result).toEqual({
      spikeChecked: 2,
      spikesRaised: 1,
      balanceChecked: 0,
      lowBalanceRaised: 0,
      rearmed: 0,
    });
    expect(caps.alerts).toHaveLength(1);
    expect(caps.alerts[0]).toMatchObject({
      organisationId: "org-spike",
      kind: "send_spike",
      periodKey: "2026-11-06T13",
      message:
        "Sending spike: 1,200 messages in the last hour, 6x the seven-day hourly average of 200.",
      details: { lastHour: 1_200, sevenDayHourlyAverage: 200, ratio: 6 },
    });

    // Within five minutes nothing is re-checked; after, the same hour raises nothing new.
    clock.now += SPIKE_CHECK_EVERY_MS - 1_000;
    expect(
      (await runAlertChecks({ store, throttle, log: quiet, now: () => new Date(clock.now) }))
        .spikeChecked,
    ).toBe(0);
    clock.now += 2_000;
    const again = await runAlertChecks({
      store,
      throttle,
      log: quiet,
      now: () => new Date(clock.now),
    });
    expect(again.spikeChecked).toBe(2);
    expect(again.spikesRaised).toBe(0);
    expect(caps.alerts).toHaveLength(1);

    // The next hour may alert again.
    clock.now = new Date("2026-11-06T14:00:30Z").getTime();
    const nextHour = await runAlertChecks({
      store,
      throttle,
      log: quiet,
      now: () => new Date(clock.now),
    });
    expect(nextHour.spikesRaised).toBe(1);
    expect(caps.alerts.map((a) => a.periodKey)).toEqual(["2026-11-06T13", "2026-11-06T14"]);
  });

  it("stores an infinite ratio as null in the alert details", async () => {
    const caps = createFakeCapsStore();
    const { store } = fakeStore(
      {
        "org-new": {
          rate: { lastHour: 150, sevenDayHourlyAverage: 0 },
          balanceMicro: 0n,
          thresholdMicro: null,
          alertedAt: null,
          emails: [],
        },
      },
      caps,
    );
    await runAlertChecks({
      store,
      throttle: fakeThrottle({ now: NOW.getTime() }),
      log: quiet,
      now: () => NOW,
    });
    expect(caps.alerts[0]?.details).toEqual({
      lastHour: 150,
      sevenDayHourlyAverage: 0,
      ratio: null,
    });
    expect(caps.alerts[0]?.message).toContain("with no sends in the seven days before");
  });

  it("fires the low balance rule once per dip, marks it, and rearms on recovery", async () => {
    const caps = createFakeCapsStore();
    const low: FakeOrg = {
      rate: { lastHour: 0, sevenDayHourlyAverage: 0 },
      balanceMicro: 4_500_000n,
      thresholdMicro: 5_000_000n,
      alertedAt: null,
      emails: ["owner@example.com"],
    };
    const { store, marks } = fakeStore({ "org-low": low }, caps);
    const clock = { now: NOW.getTime() };
    const throttle = fakeThrottle(clock);
    const deps = { store, throttle, log: quiet, now: () => new Date(clock.now) };

    const first = await runAlertChecks(deps);
    expect(first).toMatchObject({ balanceChecked: 1, lowBalanceRaised: 1, rearmed: 0 });
    expect(marks).toEqual([{ organisationId: "org-low", at: NOW }]);
    expect(caps.alerts[0]).toMatchObject({
      organisationId: "org-low",
      kind: "low_balance",
      periodKey: "2026-11-06T13",
      message: "Balance €4.50 is below the low balance threshold of €5.00.",
      details: { balanceMicro: "4500000", thresholdMicro: "5000000", recipients: 1 },
    });

    // Still low, next check: nothing new (the rule is armed off).
    clock.now += SPIKE_CHECK_EVERY_MS + 1_000;
    low.balanceMicro = 1_000_000n;
    expect(await runAlertChecks(deps)).toMatchObject({ lowBalanceRaised: 0, rearmed: 0 });

    // A deposit brings it back: rearm.
    clock.now += SPIKE_CHECK_EVERY_MS + 1_000;
    low.balanceMicro = 50_000_000n;
    expect(await runAlertChecks(deps)).toMatchObject({ lowBalanceRaised: 0, rearmed: 1 });
    expect(marks.at(-1)).toEqual({ organisationId: "org-low", at: null });

    // And the next dip fires again, in a later hour.
    clock.now = new Date("2026-11-06T15:00:00Z").getTime();
    low.balanceMicro = 10n;
    expect(await runAlertChecks(deps)).toMatchObject({ lowBalanceRaised: 1 });
    expect(caps.alerts).toHaveLength(2);
  });

  it("keeps going when one organisation's check throws", async () => {
    const caps = createFakeCapsStore();
    const { store } = fakeStore(
      {
        "org-a": {
          rate: { lastHour: 1_000, sevenDayHourlyAverage: 10 },
          balanceMicro: 0n,
          thresholdMicro: null,
          alertedAt: null,
          emails: [],
        },
        "org-b": {
          rate: { lastHour: 1_000, sevenDayHourlyAverage: 10 },
          balanceMicro: 0n,
          thresholdMicro: null,
          alertedAt: null,
          emails: [],
        },
      },
      caps,
    );
    const failing: AlertChecksStore = {
      ...store,
      async sendRate(organisationId) {
        if (organisationId === "org-a") throw new Error("boom");
        return store.sendRate(organisationId, NOW);
      },
    };
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line) });
    const result = await runAlertChecks({
      store: failing,
      throttle: fakeThrottle({ now: NOW.getTime() }),
      log,
      now: () => NOW,
    });
    expect(result.spikesRaised).toBe(1);
    expect(caps.alerts[0]?.organisationId).toBe("org-b");
    expect(lines.some((l) => l.includes("spike check failed") && l.includes("org-a"))).toBe(true);
  });
});

describe("createRedisThrottle", () => {
  it("uses SET NX PX so only the first caller within the ttl wins", async () => {
    const calls: unknown[][] = [];
    let stored = false;
    const redis = {
      async set(...args: unknown[]) {
        calls.push(args);
        if (stored) return null;
        stored = true;
        return "OK" as const;
      },
    };
    const throttle = createRedisThrottle(redis);
    expect(await throttle.tryAcquire("k", 300_000)).toBe(true);
    expect(await throttle.tryAcquire("k", 300_000)).toBe(false);
    expect(calls[0]).toEqual(["k", "1", "PX", 300_000, "NX"]);
  });
});
