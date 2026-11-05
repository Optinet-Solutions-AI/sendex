import { describe, expect, it } from "vitest";
import { clickRates, cpc, ctr, deliveryRate, formatPercent } from "./rates.js";

describe("ctr", () => {
  it("is clicks per message sent: 127 clicks on 2,394 sent is 5.30 %", () => {
    expect(ctr(127, 2394)).toBeCloseTo(0.05305, 5);
    expect(formatPercent(ctr(127, 2394))).toBe("5.30%");
  });

  it("is 0 when nothing was sent", () => {
    expect(ctr(0, 0)).toBe(0);
    expect(ctr(5, 0)).toBe(0);
  });
});

describe("cpc", () => {
  it("is the cost per click in micro-EUR, rounded", () => {
    expect(cpc(2_500_000, 10)).toBe(250_000);
    expect(cpc(1_000_000n, 3)).toBe(333_333);
  });

  it("is null without clicks", () => {
    expect(cpc(2_500_000, 0)).toBeNull();
  });
});

describe("deliveryRate", () => {
  it("is delivered per message sent: 95 of 100 is 95.00 %", () => {
    expect(deliveryRate(95, 100)).toBe(0.95);
    expect(formatPercent(deliveryRate(95, 100))).toBe("95.00%");
  });

  it("is 0 when nothing was sent", () => {
    expect(deliveryRate(0, 0)).toBe(0);
  });
});

describe("formatPercent", () => {
  it("renders a ratio with two decimals like formatEur renders cents", () => {
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(1)).toBe("100.00%");
    expect(formatPercent(0.123456)).toBe("12.35%");
  });
});

describe("clickRates", () => {
  it("derives ctr, cpc and delivery rate from counters", () => {
    expect(clickRates({ sent: 2394, delivered: 2300, clicks: 127, costMicro: 59_850_000 })).toEqual(
      {
        ctr: 127 / 2394,
        cpcMicro: 471_260,
        deliveryRate: 2300 / 2394,
      },
    );
  });
});
