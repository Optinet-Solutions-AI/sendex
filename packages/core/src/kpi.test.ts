import { describe, expect, it } from "vitest";
import {
  addCounters,
  costPerSaleMicro,
  efficiencySnapshot,
  groupListFollowUp,
  insightTotals,
  type KpiCounters,
  type ListFollowUpRow,
  leadToSale,
  type OfferCountryRow,
  roi,
  rollUp,
  smsPerSale,
  sortSalesResults,
  topOffersByCountry,
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

const cell = (country: string, offer: string, over: Partial<KpiCounters>): OfferCountryRow => ({
  country,
  offerId: offer,
  offer,
  ...ZERO_COUNTERS,
  ...over,
});

describe("performance insight (D5-04)", () => {
  const rows = [
    cell("GB", "Rolling Slots", {
      sent: 5_000,
      leads: 60,
      sales: 4,
      costMicro: 200_000_000n,
      revenueMicro: 1_200_000_000n,
    }),
    cell("GB", "Trixino", {
      sent: 3_000,
      leads: 20,
      sales: 1,
      costMicro: 120_000_000n,
      revenueMicro: 150_000_000n,
    }),
    cell("ES", "Rolling Slots", {
      sent: 2_000,
      leads: 10,
      sales: 1,
      costMicro: 50_000_000n,
      revenueMicro: 300_000_000n,
    }),
    cell("ES", "Lucky Reel", { sent: 1_000, leads: 2, costMicro: 25_000_000n }),
  ];

  it("totals everything and works out the per-sale figures", () => {
    const totals = insightTotals(rows);
    expect(totals).toMatchObject({
      sent: 11_000,
      leads: 92,
      sales: 6,
      costMicro: 395_000_000n,
      revenueMicro: 1_650_000_000n,
      profitMicro: 1_255_000_000n,
      smsPerSale: 1_833,
    });
    expect(totals.costPerSaleMicro).toBe(65_833_333n);
    expect(totals.revenuePerSaleMicro).toBe(275_000_000n);
    expect(totals.profitPerSaleMicro).toBe(209_166_666n);
  });

  it("has no per-sale figures without sales", () => {
    const totals = insightTotals([cell("ES", "Lucky Reel", { sent: 10, costMicro: 5n })]);
    expect(totals.smsPerSale).toBeNull();
    expect(totals.costPerSaleMicro).toBeNull();
    expect(totals.revenuePerSaleMicro).toBeNull();
  });

  it("rolls up by offer and by country", () => {
    const offers = rollUp(rows, "offer");
    expect(offers.map((o) => o.label)).toEqual(["Rolling Slots", "Trixino", "Lucky Reel"]);
    expect(offers[0]).toMatchObject({ sent: 7_000, sales: 5, revenueMicro: 1_500_000_000n });
    const countries = rollUp(rows, "country");
    expect(countries.map((c) => [c.label, c.sales])).toEqual([
      ["GB", 5],
      ["ES", 1],
    ]);
  });

  it("ranks the offers of each country by ROI or by sales", () => {
    const byRoi = topOffersByCountry(rows, "roi");
    expect(byRoi.map((c) => c.country)).toEqual(["GB", "ES"]);
    expect(byRoi[0]?.sales).toBe(5);
    expect(byRoi[0]?.offers.map((o) => o.offer)).toEqual(["Rolling Slots", "Trixino"]);
    // In Spain the offer that only cost money comes last.
    expect(byRoi[1]?.offers.map((o) => o.offer)).toEqual(["Rolling Slots", "Lucky Reel"]);
    const top1 = topOffersByCountry(rows, "sales", 1);
    expect(top1[0]?.offers.map((o) => o.offer)).toEqual(["Rolling Slots"]);
  });

  it("lists the offers that need the fewest SMS per sale", () => {
    expect(efficiencySnapshot(rows)).toEqual([
      { offer: "Rolling Slots", smsPerSale: 1_400, sales: 5 },
      { offer: "Trixino", smsPerSale: 3_000, sales: 1 },
    ]);
    expect(efficiencySnapshot(rows, 1)).toHaveLength(1);
  });
});

describe("sortSalesResults (D5-05)", () => {
  const rows = [
    { day: "2026-11-03", leads: 5, sales: 1, revenueMicro: 30_000_000n },
    { day: "2026-11-09", leads: 2, sales: 3, revenueMicro: 60_000_000n },
    { day: "2026-11-06", leads: 9, sales: 3, revenueMicro: 90_000_000n },
  ];

  it("sorts by the column, largest or latest first", () => {
    expect(sortSalesResults(rows, "day").map((r) => r.day)).toEqual([
      "2026-11-09",
      "2026-11-06",
      "2026-11-03",
    ]);
    expect(sortSalesResults(rows, "leads").map((r) => r.leads)).toEqual([9, 5, 2]);
    expect(sortSalesResults(rows, "revenue").map((r) => r.revenueMicro)).toEqual([
      90_000_000n,
      60_000_000n,
      30_000_000n,
    ]);
  });

  it("breaks a tie on sales with the later day", () => {
    expect(sortSalesResults(rows, "sales").map((r) => r.day)).toEqual([
      "2026-11-09",
      "2026-11-06",
      "2026-11-03",
    ]);
  });

  it("takes revenue as a string too", () => {
    const views = rows.map((r) => ({ ...r, revenueMicro: r.revenueMicro.toString() }));
    expect(sortSalesResults(views, "revenue")[0]?.day).toBe("2026-11-06");
  });
});
