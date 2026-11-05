/**
 * Per-organisation daily caps and the spike / alert rules (D3-11). Pure: the worker
 * feeds today's usage and the batch it wants to send, this decides; `packages/db`
 * stores the alert rows. Money is micro-EUR bigint as everywhere else.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Daily caps
// ---------------------------------------------------------------------------

export interface DailyCaps {
  /** Messages the organisation may send per UTC day; null means unlimited. */
  dailyMessageCap: number | null;
  /** Micro-EUR the organisation may be debited per UTC day; null means unlimited. */
  dailySpendCapMicro: bigint | null;
}

export const CAP_REASONS = ["daily_message_cap", "daily_spend_cap"] as const;
export type CapReason = (typeof CAP_REASONS)[number];

export interface CapDecisionInput {
  /** Messages the organisation created today (every status but cancelled). */
  sentToday: number;
  /** Net micro-EUR debited for messages today (debits less refunds), non-negative. */
  spentTodayMicro: bigint;
  /** Messages the loop wants to create next. */
  batchSize: number;
  /** Estimated cost of the whole batch in micro-EUR. */
  batchCostMicro: bigint;
  caps: DailyCaps;
}

export type CapDecision =
  /** The whole batch fits. */
  | { action: "allow" }
  /** Only `allowed` (1 .. batchSize - 1) messages fit; the rest would cross `reason`. */
  | { action: "trim"; allowed: number; reason: CapReason }
  /** Not one more message fits today. */
  | { action: "refuse"; reason: CapReason };

function bigintToSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > max ? max : value < 0n ? 0n : value);
}

/**
 * How much of a batch the caps still allow today. The spend allowance is derived from the
 * batch's average cost per message (rounded up, so the estimate is conservative). When both
 * caps bind the tighter one is named; on a tie the message cap.
 */
export function capDecision(input: CapDecisionInput): CapDecision {
  const { caps, batchSize } = input;
  if (batchSize <= 0) return { action: "allow" };

  let allowed = batchSize;
  let reason: CapReason | null = null;

  if (caps.dailySpendCapMicro !== null && input.batchCostMicro > 0n) {
    const perMessage = (input.batchCostMicro + BigInt(batchSize) - 1n) / BigInt(batchSize) || 1n;
    const left = caps.dailySpendCapMicro - input.spentTodayMicro;
    const bySpend = left <= 0n ? 0 : bigintToSafeNumber(left / perMessage);
    if (bySpend < allowed) {
      allowed = bySpend;
      reason = "daily_spend_cap";
    }
  }
  if (caps.dailyMessageCap !== null) {
    const byMessages = Math.max(0, caps.dailyMessageCap - input.sentToday);
    if (byMessages <= allowed) {
      // `<=` so that a tie with the spend cap is reported as the message cap.
      if (byMessages < allowed || reason !== null) reason = "daily_message_cap";
      allowed = byMessages;
    }
  }

  if (reason === null || allowed >= batchSize) return { action: "allow" };
  if (allowed <= 0) return { action: "refuse", reason };
  return { action: "trim", allowed, reason };
}

/** "daily message cap" / "daily spend cap", for lap rows, audit details and alerts. */
export function capReasonLabel(reason: CapReason): string {
  return reason === "daily_message_cap" ? "daily message cap" : "daily spend cap";
}

// ---------------------------------------------------------------------------
// Spike rule
// ---------------------------------------------------------------------------

/** Alert when the last hour exceeds this many times the seven-day hourly average. */
export const SPIKE_MULTIPLIER = 5;
/** Below this many messages in the last hour nothing is a spike (new or tiny accounts). */
export const SPIKE_MIN_LAST_HOUR = 100;

export interface SpikeInput {
  /** Messages created in the last 60 minutes. */
  lastHour: number;
  /** Messages per hour over the previous seven days (168 hours), excluding the last hour. */
  sevenDayHourlyAverage: number;
  multiplier?: number;
  minLastHour?: number;
}

export type SpikeDecision = { spike: false } | { spike: true; ratio: number };

/** `lastHour > multiplier x average`, once `lastHour` reaches the floor. */
export function spikeDecision(input: SpikeInput): SpikeDecision {
  const multiplier = input.multiplier ?? SPIKE_MULTIPLIER;
  const floor = input.minLastHour ?? SPIKE_MIN_LAST_HOUR;
  if (input.lastHour < floor) return { spike: false };
  if (input.sevenDayHourlyAverage <= 0) return { spike: true, ratio: Number.POSITIVE_INFINITY };
  const ratio = input.lastHour / input.sevenDayHourlyAverage;
  if (ratio <= multiplier) return { spike: false };
  return { spike: true, ratio: Math.round(ratio * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// Period keys (UTC)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" in UTC: the period key of a daily cap alert. */
export function utcDayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** "YYYY-MM-DDTHH" in UTC: the period key of an hourly alert (spike, low balance). */
export function hourKeyUtc(at: Date): string {
  return at.toISOString().slice(0, 13);
}

/** Midnight UTC of the day `at` falls in: where "today" starts for the caps. */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export const ALERT_KINDS = [
  "daily_message_cap",
  "daily_spend_cap",
  "send_spike",
  "low_balance",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** JSON-safe scalars only: bigints go in as decimal strings. */
const alertDetailValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * What the worker (or a test helper) hands to `raiseAlert`. `periodKey` is the idempotency
 * scope: one alert per (organisation, kind, periodKey), a UTC day for the caps and a UTC
 * hour for the spike and low balance rules.
 */
export const alertPayloadSchema = z.object({
  kind: z.enum(ALERT_KINDS),
  periodKey: z.string().trim().min(1).max(64),
  message: z.string().trim().min(1).max(500),
  details: z.record(z.string(), alertDetailValue).default({}),
});
export type AlertPayload = z.infer<typeof alertPayloadSchema>;
export type AlertPayloadInput = z.input<typeof alertPayloadSchema>;

export function isAlertKind(value: unknown): value is AlertKind {
  return typeof value === "string" && (ALERT_KINDS as readonly string[]).includes(value);
}
