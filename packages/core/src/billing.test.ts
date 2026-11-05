import { describe, expect, it } from "vitest";
import {
  billingSettingsSchema,
  depositSchema,
  eurToMicro,
  formatEur,
  LEDGER_KINDS,
  ledgerFilterSchema,
  shouldAlertLowBalance,
} from "./billing.js";

describe("formatEur", () => {
  it("formats micro-EUR with thousands separators and two decimals", () => {
    expect(formatEur(4_988_310_000n)).toBe("EUR 4,988.31");
    expect(formatEur(3_470_510_000n)).toBe("EUR 3,470.51");
    expect(formatEur(0n)).toBe("EUR 0.00");
    expect(formatEur(1_000_000n)).toBe("EUR 1.00");
    expect(formatEur(25_000_000n)).toBe("EUR 25.00");
  });

  it("rounds sub-cent amounts half away from zero", () => {
    expect(formatEur(35_700n)).toBe("EUR 0.04");
    expect(formatEur(34_999n)).toBe("EUR 0.03");
    expect(formatEur(5_000n)).toBe("EUR 0.01");
  });

  it("keeps the sign of debits", () => {
    expect(formatEur(-35_700n)).toBe("-EUR 0.04");
    expect(formatEur(-1_234_560_000n)).toBe("-EUR 1,234.56");
  });
});

describe("eurToMicro", () => {
  it("parses decimal strings without floating point drift", () => {
    expect(eurToMicro("25")).toBe(25_000_000n);
    expect(eurToMicro("25.5")).toBe(25_500_000n);
    expect(eurToMicro("0.07")).toBe(70_000n);
    expect(eurToMicro("1,234.56")).toBe(1_234_560_000n);
    expect(eurToMicro("0.0357")).toBe(35_700n);
  });

  it("rejects more than six decimals, negatives and junk", () => {
    expect(() => eurToMicro("1.1234567")).toThrow();
    expect(() => eurToMicro("-5")).toThrow();
    expect(() => eurToMicro("abc")).toThrow();
    expect(() => eurToMicro("")).toThrow();
  });
});

describe("shouldAlertLowBalance", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  const earlier = new Date("2026-11-05T10:00:00Z");

  it("does nothing without a threshold", () => {
    expect(
      shouldAlertLowBalance({ balanceMicro: 0n, thresholdMicro: null, alertedAt: null, now }),
    ).toEqual({ action: "none" });
  });

  it("alerts the first time the balance dips below the threshold", () => {
    expect(
      shouldAlertLowBalance({
        balanceMicro: 9_990_000n,
        thresholdMicro: 10_000_000n,
        alertedAt: null,
        now,
      }),
    ).toEqual({ action: "alert", alertedAt: now });
  });

  it("does not alert again while still below the threshold", () => {
    expect(
      shouldAlertLowBalance({
        balanceMicro: 1_000_000n,
        thresholdMicro: 10_000_000n,
        alertedAt: earlier,
        now,
      }),
    ).toEqual({ action: "none" });
  });

  it("does not alert at exactly the threshold", () => {
    expect(
      shouldAlertLowBalance({
        balanceMicro: 10_000_000n,
        thresholdMicro: 10_000_000n,
        alertedAt: null,
        now,
      }),
    ).toEqual({ action: "none" });
  });

  it("rearms once the balance recovers to the threshold or above", () => {
    expect(
      shouldAlertLowBalance({
        balanceMicro: 10_000_000n,
        thresholdMicro: 10_000_000n,
        alertedAt: earlier,
        now,
      }),
    ).toEqual({ action: "rearm" });
    expect(
      shouldAlertLowBalance({
        balanceMicro: 50_000_000n,
        thresholdMicro: 10_000_000n,
        alertedAt: earlier,
        now,
      }),
    ).toEqual({ action: "rearm" });
  });

  it("stays quiet when above the threshold and not armed", () => {
    expect(
      shouldAlertLowBalance({
        balanceMicro: 50_000_000n,
        thresholdMicro: 10_000_000n,
        alertedAt: null,
        now,
      }),
    ).toEqual({ action: "none" });
  });

  it("rearms when the threshold is removed while alerted", () => {
    expect(
      shouldAlertLowBalance({
        balanceMicro: 1n,
        thresholdMicro: null,
        alertedAt: earlier,
        now,
      }),
    ).toEqual({ action: "rearm" });
  });
});

describe("depositSchema", () => {
  it("accepts a manual deposit and converts the amount to micro-EUR", () => {
    const parsed = depositSchema.parse({
      amountEur: "25",
      method: "manual",
      reference: "  wire-2026-11-06  ",
      note: "",
    });
    expect(parsed).toEqual({
      amountMicro: 25_000_000n,
      method: "manual",
      reference: "wire-2026-11-06",
      note: null,
    });
  });

  it("rejects zero, negative and more than two decimals", () => {
    expect(
      depositSchema.safeParse({ amountEur: "0", method: "wire", reference: "x" }).success,
    ).toBe(false);
    expect(
      depositSchema.safeParse({ amountEur: "-1", method: "wire", reference: "x" }).success,
    ).toBe(false);
    expect(
      depositSchema.safeParse({ amountEur: "1.234", method: "wire", reference: "x" }).success,
    ).toBe(false);
  });

  it("requires a reference and a known method", () => {
    expect(
      depositSchema.safeParse({ amountEur: "5", method: "wire", reference: " " }).success,
    ).toBe(false);
    expect(
      depositSchema.safeParse({ amountEur: "5", method: "paypal", reference: "x" }).success,
    ).toBe(false);
  });
});

describe("billingSettingsSchema", () => {
  it("parses thresholds and caps, treating blanks as null", () => {
    const parsed = billingSettingsSchema.parse({
      lowBalanceThresholdEur: "100",
      lowBalanceEmails: ["ops@example.com", " ", "owner@example.com"],
      dailyMessageCap: "",
      dailySpendCapEur: "250.50",
    });
    expect(parsed).toEqual({
      lowBalanceThresholdMicro: 100_000_000n,
      lowBalanceEmails: ["ops@example.com", "owner@example.com"],
      dailyMessageCap: null,
      dailySpendCapMicro: 250_500_000n,
    });
  });

  it("limits the alert emails to five valid addresses", () => {
    const six = Array.from({ length: 6 }, (_, i) => `a${i}@example.com`);
    expect(
      billingSettingsSchema.safeParse({ lowBalanceThresholdEur: "", lowBalanceEmails: six })
        .success,
    ).toBe(false);
    expect(
      billingSettingsSchema.safeParse({ lowBalanceThresholdEur: "", lowBalanceEmails: ["nope"] })
        .success,
    ).toBe(false);
  });

  it("rejects a negative threshold and a non-integer message cap", () => {
    expect(
      billingSettingsSchema.safeParse({ lowBalanceThresholdEur: "-1", lowBalanceEmails: [] })
        .success,
    ).toBe(false);
    expect(
      billingSettingsSchema.safeParse({
        lowBalanceThresholdEur: "",
        lowBalanceEmails: [],
        dailyMessageCap: "10.5",
      }).success,
    ).toBe(false);
  });
});

describe("ledgerFilterSchema", () => {
  it("accepts the ledger kinds and ISO dates", () => {
    expect(LEDGER_KINDS).toEqual(["deposit", "debit", "refund", "adjustment"]);
    const parsed = ledgerFilterSchema.parse({
      kind: "debit",
      from: "2026-11-01",
      to: "2026-11-06",
    });
    expect(parsed.kind).toBe("debit");
    expect(parsed.from).toBe("2026-11-01");
  });

  it("rejects unknown kinds and malformed dates", () => {
    expect(ledgerFilterSchema.safeParse({ kind: "fee" }).success).toBe(false);
    expect(ledgerFilterSchema.safeParse({ from: "06/11/2026" }).success).toBe(false);
  });
});
