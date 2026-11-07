import { describe, expect, it } from "vitest";
import {
  enrichmentRuleSchema,
  eurToMicroBudget,
  lookupVerdict,
  ruleAllowance,
  verificationCostMicro,
  verificationKpis,
  verificationSummaryCsv,
} from "./verification.js";

describe("verification", () => {
  it("maps statuses to verdicts", () => {
    expect(lookupVerdict("hlr")).toBe("good");
    expect(lookupVerdict("mnp")).toBe("good");
    expect(lookupVerdict("local_only")).toBe("good");
    expect(lookupVerdict("bad")).toBe("bad");
    expect(lookupVerdict("blacklisted")).toBe("bad");
    expect(lookupVerdict("unresolved")).toBe("none");
    expect(lookupVerdict("checking")).toBe("none");
  });

  it("parses the enrichment rule form with the spec's defaults", () => {
    const rule = enrichmentRuleSchema.parse({
      country: "de",
      dailyLimit: "5000",
      monthlyBudgetEur: "25",
    });
    expect(rule).toEqual({
      country: "DE",
      dailyLimit: 5000,
      monthlyBudgetEur: "25",
      onSchedule: true,
      afterUpload: false,
      asYouSend: false,
      includeArchived: false,
    });
    expect(
      enrichmentRuleSchema.safeParse({ country: "", dailyLimit: 1, monthlyBudgetEur: "1" }).success,
    ).toBe(false);
    expect(
      enrichmentRuleSchema.safeParse({ country: "DE", dailyLimit: 0, monthlyBudgetEur: "1" })
        .success,
    ).toBe(false);
    expect(eurToMicroBudget("25")).toBe(25_000_000n);
    expect(eurToMicroBudget("0.5")).toBe(500_000n);
  });

  it("limits a run by the day, the month's budget and the price", () => {
    const base = {
      dailyLimit: 5000,
      monthlyBudgetMicro: 25_000_000n,
      verifiedToday: 0,
      spentThisMonthMicro: 0n,
    };
    expect(ruleAllowance({ ...base, priceMicro: 1_000n })).toBe(5000);
    expect(ruleAllowance({ ...base, priceMicro: 10_000n })).toBe(2500);
    expect(ruleAllowance({ ...base, verifiedToday: 4990, priceMicro: 1_000n })).toBe(10);
    expect(ruleAllowance({ ...base, spentThisMonthMicro: 25_000_000n, priceMicro: 1_000n })).toBe(
      0,
    );
    expect(ruleAllowance({ ...base, priceMicro: null })).toBe(0);
    expect(ruleAllowance({ ...base, priceMicro: 0n })).toBe(5000);
  });

  it("builds the KPI strip and the summary CSV", () => {
    expect(
      verificationKpis({ totalUnique: 100, byStatus: { hlr: 30, mnp: 5, bad: 10, unresolved: 5 } }),
    ).toEqual({
      totalUnique: 100,
      scanned: 50,
      good: 35,
      bad: 10,
      notChecked: 50,
    });
    expect(
      verificationSummaryCsv([
        { day: "2026-11-07", country: "DE", total: 10, good: 8, bad: 1, noVerdict: 1 },
      ]),
    ).toBe("Date,Country,Total,Good,Bad,No verdict\r\n2026-11-07,DE,10,8,1,1\r\n");
    expect(verificationCostMicro(1000, 1_000n)).toBe(1_000_000n);
    expect(verificationCostMicro(1000, null)).toBeNull();
  });
});
