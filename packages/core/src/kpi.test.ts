import { describe, expect, it } from "vitest";
import {
  addCounters,
  costPerSaleMicro,
  groupListFollowUp,
  type KpiCounters,
  type ListFollowUpRow,
  leadToSale,
  roi,
  smsPerSale,
  ZERO_COUNTERS,
} from "./kpi.js";

const c = (over: Partial<KpiCounters>): KpiCounters => ({ ...ZERO_COUNTERS, ...over });

describe("ratios", () => {
  it("sales per lead, null without leads", () => {
    expect(leadToSale(c({ leads: 20, sales: 3 }))).toBeCloseTo(0.15);
    expect(leadToSale(c({ leads: 0, sales: 0 }))).toBeNull();
  });

  it("ROI is profit over cost, as on the dashboard, null without cost", () => {
    expect(roi(c({ costMicro: 100_000_000n, revenueMicro: 250_000_000n }))).toBeCloseTo(1.5);
    expect(roi(c({ costMicro: 100_000_000n, revenueMicro: 40_000_000n }))).toBeCloseTo(-0.6);
    expect(roi(c({ revenueMicro: 40_000_000n }))).toBeNull();
  });

  it("SMS per sale, rounded, null without sales", () => {
    expect(smsPerSale(c({ sent: 5_246, sales: 2 }))).toBe(2_623);
    expect(smsPerSale(c({ sent: 100, sales: 3 }))).toBe(33);
    expect(smsPerSale(c({ sent: 100 }))).toBeNull();
  });

  it("cost per sale, null without sales", () => {
    expect(costPerSaleMicro(c({ costMicro: 302_000_000n, sales: 2 }))).toBe(151_000_000n);
    expect(costPerSaleMicro(c({ costMicro: 302_000_000n }))).toBeNull();
  });

  it("adds counters field by field", () => {
    expect(
      addCounters(
        c({ sent: 10, leads: 2, sales: 1, costMicro: 5n, revenueMicro: 7n }),
        c({ sent: 5, leads: 1, sales: 0, costMicro: 3n, revenueMicro: 0n }),
      ),
    ).toEqual({ sent: 15, leads: 3, sales: 1, costMicro: 8n, revenueMicro: 7n });
  });
});

const row = (
  over: Partial<ListFollowUpRow> & { name: string; country: string },
): ListFollowUpRow => ({
  listId: over.name,
  provider: null,
  numbersCount: 300,
  lastSentAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...ZERO_COUNTERS,
  ...over,
});

describe("groupListFollowUp", () => {
  const rows = [
    row({
      name: "UK_ZEN_1",
      country: "GB",
      sent: 500,
      leads: 30,
      sales: 6,
      costMicro: 20_000_000n,
      revenueMicro: 90_000_000n,
      lastSentAt: new Date("2026-11-10T10:00:00Z"),
    }),
    row({
      name: "UK_DER_1",
      country: "GB",
      sent: 200,
      leads: 10,
      sales: 1,
      costMicro: 8_000_000n,
      revenueMicro: 10_000_000n,
      lastSentAt: new Date("2026-11-12T10:00:00Z"),
    }),
    row({ name: "UK_ZEN_3", country: "GB" }),
    row({
      name: "ES_DER_1",
      country: "ES",
      sent: 300,
      leads: 5,
      sales: 0,
      costMicro: 9_000_000n,
      lastSentAt: new Date("2026-11-01T10:00:00Z"),
    }),
    row({ name: "DE_ZEN_1", country: "DE" }),
  ];
  const grouped = groupListFollowUp(rows);

  it("groups the lists that were sent by country and totals them", () => {
    expect(grouped.countries.map((g) => g.country)).toEqual(["GB", "ES"]);
    const gb = grouped.countries[0];
    expect(gb?.totalLists).toBe(2);
    expect(gb?.sent).toBe(700);
    expect(gb?.leads).toBe(40);
    expect(gb?.sales).toBe(7);
    expect(gb?.costMicro).toBe(28_000_000n);
    expect(gb?.revenueMicro).toBe(100_000_000n);
    expect(gb?.lastSentAt?.toISOString()).toBe("2026-11-12T10:00:00.000Z");
  });

  it("orders countries by ROI, best first, and lists by sales", () => {
    // GB makes money, ES only costs.
    expect(grouped.countries[0]?.country).toBe("GB");
    expect(grouped.countries[0]?.lists.map((l) => l.name)).toEqual(["UK_ZEN_1", "UK_DER_1"]);
  });

  it("keeps the lists with no send apart, by country then name", () => {
    expect(grouped.untouched.map((l) => l.name)).toEqual(["DE_ZEN_1", "UK_ZEN_3"]);
  });

  it("is empty for no lists", () => {
    expect(groupListFollowUp([])).toEqual({ countries: [], untouched: [] });
  });
});
