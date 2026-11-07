import { describe, expect, it } from "vitest";
import {
  billingQueryString,
  dayRangeBounds,
  defaultSummaryRange,
  parseBillingQuery,
} from "./billing-params";

describe("parseBillingQuery", () => {
  it("defaults to the deposits tab with no filters", () => {
    expect(parseBillingQuery({})).toEqual({
      tab: "deposits",
      kind: "",
      from: "",
      to: "",
      page: 1,
    });
  });

  it("keeps known tabs, kinds, ISO dates and pages", () => {
    expect(
      parseBillingQuery({
        tab: "transactions",
        kind: "debit",
        from: "2026-11-01",
        to: "2026-11-06",
        page: "3",
      }),
    ).toEqual({
      tab: "transactions",
      kind: "debit",
      from: "2026-11-01",
      to: "2026-11-06",
      page: 3,
    });
  });

  it("drops unknown tabs, kinds, malformed dates and bad pages", () => {
    expect(
      parseBillingQuery({ tab: "invoices", kind: "bonus", from: "06/11/2026", to: "x", page: "0" }),
    ).toEqual({ tab: "deposits", kind: "", from: "", to: "", page: 1 });
    expect(parseBillingQuery({ page: ["2", "9"] }).page).toBe(2);
  });
});

describe("billingQueryString", () => {
  it("leaves defaults out", () => {
    expect(billingQueryString({ tab: "deposits", kind: "", from: "", to: "", page: 1 })).toBe("");
    expect(
      billingQueryString({
        tab: "transactions",
        kind: "refund",
        from: "2026-11-01",
        to: "",
        page: 2,
      }),
    ).toBe("?tab=transactions&kind=refund&from=2026-11-01&page=2");
  });
});

describe("dayRangeBounds", () => {
  it("turns inclusive ISO days into a [from, to) UTC range", () => {
    const bounds = dayRangeBounds("2026-11-01", "2026-11-06");
    expect(bounds.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(bounds.to?.toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  it("leaves an open end undefined", () => {
    expect(dayRangeBounds("", "")).toEqual({ from: undefined, to: undefined });
    expect(dayRangeBounds("2026-11-01", "").to).toBeUndefined();
  });
});

describe("defaultSummaryRange", () => {
  it("is the last thirty days ending today, as ISO days", () => {
    const today = new Date("2026-11-06T15:00:00Z");
    expect(defaultSummaryRange(today)).toEqual({ from: "2026-10-07", to: "2026-11-06" });
  });
});
