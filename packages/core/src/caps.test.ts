import { describe, expect, it } from "vitest";
import {
  ALERT_KINDS,
  alertPayloadSchema,
  capDecision,
  capReasonLabel,
  type DailyCaps,
  hourKeyUtc,
  SPIKE_MIN_LAST_HOUR,
  SPIKE_MULTIPLIER,
  spikeDecision,
  startOfUtcDay,
  utcDayKey,
} from "./caps.js";

const noCaps: DailyCaps = { dailyMessageCap: null, dailySpendCapMicro: null };

describe("capDecision", () => {
  it("allows everything when no cap is set", () => {
    expect(
      capDecision({
        sentToday: 1_000_000,
        spentTodayMicro: 10n ** 12n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: noCaps,
      }),
    ).toEqual({ action: "allow" });
  });

  it("allows a batch that fits under both caps", () => {
    expect(
      capDecision({
        sentToday: 400,
        spentTodayMicro: 10_000_000n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: { dailyMessageCap: 500, dailySpendCapMicro: 20_000_000n },
      }),
    ).toEqual({ action: "allow" });
  });

  it("trims the batch to what the message cap still allows", () => {
    expect(
      capDecision({
        sentToday: 480,
        spentTodayMicro: 0n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: { dailyMessageCap: 500, dailySpendCapMicro: null },
      }),
    ).toEqual({ action: "trim", allowed: 20, reason: "daily_message_cap" });
  });

  it("refuses the batch once the message cap is reached", () => {
    expect(
      capDecision({
        sentToday: 500,
        spentTodayMicro: 0n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: { dailyMessageCap: 500, dailySpendCapMicro: null },
      }),
    ).toEqual({ action: "refuse", reason: "daily_message_cap" });
    // Past the cap (another lap overshot) is refused too, never a negative allowance.
    expect(
      capDecision({
        sentToday: 530,
        spentTodayMicro: 0n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: { dailyMessageCap: 500, dailySpendCapMicro: null },
      }),
    ).toEqual({ action: "refuse", reason: "daily_message_cap" });
  });

  it("trims by the spend cap using the per-message cost of the batch", () => {
    // 50 messages cost 1.25 (0.025 each); 0.30 left -> 12 messages.
    expect(
      capDecision({
        sentToday: 0,
        spentTodayMicro: 9_700_000n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: { dailyMessageCap: null, dailySpendCapMicro: 10_000_000n },
      }),
    ).toEqual({ action: "trim", allowed: 12, reason: "daily_spend_cap" });
  });

  it("refuses when the spend cap is reached or the next message would exceed it", () => {
    expect(
      capDecision({
        sentToday: 0,
        spentTodayMicro: 10_000_000n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: { dailyMessageCap: null, dailySpendCapMicro: 10_000_000n },
      }),
    ).toEqual({ action: "refuse", reason: "daily_spend_cap" });
    expect(
      capDecision({
        sentToday: 0,
        spentTodayMicro: 9_990_000n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: { dailyMessageCap: null, dailySpendCapMicro: 10_000_000n },
      }),
    ).toEqual({ action: "refuse", reason: "daily_spend_cap" });
  });

  it("names the tighter cap when both bind, preferring the message cap on a tie", () => {
    expect(
      capDecision({
        sentToday: 490,
        spentTodayMicro: 9_900_000n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: { dailyMessageCap: 500, dailySpendCapMicro: 10_000_000n },
      }),
    ).toEqual({ action: "trim", allowed: 4, reason: "daily_spend_cap" });
    expect(
      capDecision({
        sentToday: 496,
        spentTodayMicro: 9_900_000n,
        batchSize: 50,
        batchCostMicro: 1_250_000n,
        caps: { dailyMessageCap: 500, dailySpendCapMicro: 10_000_000n },
      }),
    ).toEqual({ action: "trim", allowed: 4, reason: "daily_message_cap" });
  });

  it("treats a zero-cost batch as unconstrained by the spend cap", () => {
    expect(
      capDecision({
        sentToday: 0,
        spentTodayMicro: 10_000_000n,
        batchSize: 50,
        batchCostMicro: 0n,
        caps: { dailyMessageCap: null, dailySpendCapMicro: 10_000_000n },
      }),
    ).toEqual({ action: "allow" });
  });

  it("allows an empty batch", () => {
    expect(
      capDecision({
        sentToday: 500,
        spentTodayMicro: 0n,
        batchSize: 0,
        batchCostMicro: 0n,
        caps: { dailyMessageCap: 500, dailySpendCapMicro: null },
      }),
    ).toEqual({ action: "allow" });
  });

  it("has a human label per reason", () => {
    expect(capReasonLabel("daily_message_cap")).toBe("daily message cap");
    expect(capReasonLabel("daily_spend_cap")).toBe("daily spend cap");
  });
});

describe("spikeDecision", () => {
  it("alerts when the last hour exceeds five times the seven-day hourly average", () => {
    expect(SPIKE_MULTIPLIER).toBe(5);
    expect(spikeDecision({ lastHour: 1_001, sevenDayHourlyAverage: 200 })).toEqual({
      spike: true,
      ratio: 5.005,
    });
  });

  it("does not alert at or under five times the average", () => {
    expect(spikeDecision({ lastHour: 1_000, sevenDayHourlyAverage: 200 })).toEqual({
      spike: false,
    });
    expect(spikeDecision({ lastHour: 300, sevenDayHourlyAverage: 200 })).toEqual({ spike: false });
  });

  it("ignores small volumes so a new organisation's first sends are not a spike", () => {
    expect(SPIKE_MIN_LAST_HOUR).toBe(100);
    expect(spikeDecision({ lastHour: 99, sevenDayHourlyAverage: 0 })).toEqual({ spike: false });
    expect(spikeDecision({ lastHour: 99, sevenDayHourlyAverage: 1 })).toEqual({ spike: false });
  });

  it("alerts on a zero average once the floor is passed, with an infinite ratio", () => {
    expect(spikeDecision({ lastHour: 100, sevenDayHourlyAverage: 0 })).toEqual({
      spike: true,
      ratio: Number.POSITIVE_INFINITY,
    });
  });

  it("takes a custom multiplier and floor", () => {
    expect(
      spikeDecision({ lastHour: 31, sevenDayHourlyAverage: 10, multiplier: 3, minLastHour: 10 }),
    ).toEqual({ spike: true, ratio: 3.1 });
  });
});

describe("period keys", () => {
  const at = new Date("2026-11-06T13:45:10Z");

  it("derives the UTC day and hour keys and the start of the UTC day", () => {
    expect(utcDayKey(at)).toBe("2026-11-06");
    expect(hourKeyUtc(at)).toBe("2026-11-06T13");
    expect(startOfUtcDay(at).toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });
});

describe("alertPayloadSchema", () => {
  it("lists the four alert kinds", () => {
    expect([...ALERT_KINDS]).toEqual([
      "daily_message_cap",
      "daily_spend_cap",
      "send_spike",
      "low_balance",
    ]);
  });

  it("accepts a well-formed payload and defaults details", () => {
    expect(
      alertPayloadSchema.parse({
        kind: "send_spike",
        periodKey: "2026-11-06T13",
        message: "Sends in the last hour are 6.2x the seven-day average",
      }),
    ).toEqual({
      kind: "send_spike",
      periodKey: "2026-11-06T13",
      message: "Sends in the last hour are 6.2x the seven-day average",
      details: {},
    });
  });

  it("rejects unknown kinds, blank messages and non-JSON details", () => {
    expect(
      alertPayloadSchema.safeParse({ kind: "other", periodKey: "x", message: "m" }).success,
    ).toBe(false);
    expect(
      alertPayloadSchema.safeParse({ kind: "low_balance", periodKey: "x", message: " " }).success,
    ).toBe(false);
    expect(
      alertPayloadSchema.safeParse({
        kind: "low_balance",
        periodKey: "x",
        message: "m",
        details: { balanceMicro: 10n },
      }).success,
    ).toBe(false);
    expect(
      alertPayloadSchema.safeParse({
        kind: "low_balance",
        periodKey: "x",
        message: "m",
        details: { balanceMicro: "10", refused: 3, ok: true, none: null },
      }).success,
    ).toBe(true);
  });
});
