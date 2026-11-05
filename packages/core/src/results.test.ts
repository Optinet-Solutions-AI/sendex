import { describe, expect, it } from "vitest";
import { costPerMicro, formatPercent, ratioOf, resultRates, sumResultCounters } from "./results.js";

describe("ratioOf", () => {
  it("divides and returns 0 for an empty denominator", () => {
    expect(ratioOf(5, 200)).toBe(0.025);
    expect(ratioOf(0, 200)).toBe(0);
    expect(ratioOf(3, 0)).toBe(0);
  });
});

describe("costPerMicro", () => {
  it("divides micro-EUR by a count with integer arithmetic, rounded half up", () => {
    expect(costPerMicro(5_200_000n, 10)).toBe(520_000n);
    expect(costPerMicro(5_000_000n, 3)).toBe(1_666_667n);
    expect(costPerMicro(1n, 2)).toBe(1n);
    expect(costPerMicro(0n, 4)).toBe(0n);
  });

  it("is null when nothing was counted", () => {
    expect(costPerMicro(5_000_000n, 0)).toBeNull();
  });
});

describe("resultRates", () => {
  it("derives CTR, delivery rate, CPC, CPL and CPS from counters", () => {
    expect(
      resultRates({
        sent: 200,
        delivered: 180,
        failed: 20,
        clicks: 10,
        leads: 2,
        sales: 1,
        costMicro: 5_200_000n,
      }),
    ).toEqual({
      ctr: 0.05,
      deliveryRate: 0.9,
      failureRate: 0.1,
      cpcMicro: 520_000n,
      cplMicro: 2_600_000n,
      cpsMicro: 5_200_000n,
    });
  });

  it("is all zero / null for an unsent lap", () => {
    expect(
      resultRates({
        sent: 0,
        delivered: 0,
        failed: 0,
        clicks: 0,
        leads: 0,
        sales: 0,
        costMicro: 0n,
      }),
    ).toEqual({
      ctr: 0,
      deliveryRate: 0,
      failureRate: 0,
      cpcMicro: null,
      cplMicro: null,
      cpsMicro: null,
    });
  });
});

describe("sumResultCounters", () => {
  it("adds counters, keeping the cost as a bigint", () => {
    expect(
      sumResultCounters([
        {
          sent: 100,
          delivered: 90,
          failed: 10,
          clicks: 5,
          leads: 1,
          sales: 0,
          costMicro: 2_500_000n,
        },
        {
          sent: 100,
          delivered: 80,
          failed: 20,
          clicks: 7,
          leads: 1,
          sales: 1,
          costMicro: 2_700_000n,
        },
      ]),
    ).toEqual({
      sent: 200,
      delivered: 170,
      failed: 30,
      clicks: 12,
      leads: 2,
      sales: 1,
      costMicro: 5_200_000n,
    });
    expect(sumResultCounters([]).costMicro).toBe(0n);
  });
});

describe("formatPercent", () => {
  it("formats a ratio with two decimals by default", () => {
    expect(formatPercent(0.05)).toBe("5.00%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(1)).toBe("100.00%");
    expect(formatPercent(0.123456, 1)).toBe("12.3%");
  });
});
