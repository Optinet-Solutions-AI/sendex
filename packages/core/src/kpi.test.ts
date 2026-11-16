import { describe, expect, it } from "vitest";
import {
  addCounters,
  costPerSaleMicro,
  creatorPeriod,
  type DailyRow,
  efficiencySnapshot,
  groupListFollowUp,
  insightTotals,
  type KpiCounters,
  type ListFollowUpRow,
  leadToSale,
  type OfferCountryRow,
  plannedCampaignName,
  plannedCampaignSchema,
  rankCountriesForOffer,
  rankListsForOffer,
  rankOffersForCountry,
  roi,
  rollUp,
  smsPerSale,
  sortSalesResults,
  throughDay,
  topOffersByCountry,
  trendBreakdown,
  trendSeries,
  trendSummary,
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

describe("trends (D5-06)", () => {
  const d = (day: string, key: string, leads: number, sales: number): DailyRow => ({
    day,
    key,
    leads,
    sales,
  });
  const november = [
    d("2026-11-01", "724", 10, 1),
    d("2026-11-01", "137", 5, 0),
    d("2026-11-03", "724", 20, 4),
    d("2026-11-16", "137", 8, 2),
    d("2026-11-20", "724", 6, 0),
  ];
  const october = [
    d("2026-10-01", "724", 4, 1),
    d("2026-10-03", "724", 6, 0),
    d("2026-10-25", "724", 30, 9),
  ];

  it("knows how far into the month the figures go", () => {
    const midNovember = new Date("2026-11-16T12:00:00Z");
    expect(throughDay(2026, 11, midNovember)).toBe(16);
    expect(throughDay(2026, 10, midNovember)).toBe(31);
    expect(throughDay(2026, 2, midNovember)).toBe(28);
    expect(throughDay(2026, 12, midNovember)).toBe(0);
  });

  it("compares the month with the same days of the month before", () => {
    const summary = trendSummary(november, october, 16);
    // Through day 16: 43 leads and 7 sales now; 10 leads and 1 sale a month earlier.
    expect(summary.leads).toBe(43);
    expect(summary.sales).toBe(7);
    expect(summary.conversion).toBeCloseTo(7 / 43);
    expect(summary.leadsChange).toBeCloseTo(3.3);
    expect(summary.salesChange).toBeCloseTo(6);
    expect(summary.conversionChangePoints).toBeCloseTo((7 / 43 - 1 / 10) * 100);
  });

  it("has no change to show when the month before was empty", () => {
    const summary = trendSummary(november, [], 16);
    expect(summary.leadsChange).toBeNull();
    expect(summary.salesChange).toBeNull();
    expect(summary.conversionChangePoints).toBeNull();
  });

  it("gives one point per day, daily or running totals, up to the day reached", () => {
    const daily = trendSeries(november, october, { year: 2026, month: 11, through: 16 });
    expect(daily).toHaveLength(30);
    expect(daily[0]).toEqual({ day: 1, leads: 15, sales: 1, prevLeads: 4, prevSales: 1 });
    expect(daily[1]).toEqual({ day: 2, leads: 0, sales: 0, prevLeads: 0, prevSales: 0 });
    // Nothing is known after day 16 of the month in progress; the month before is complete.
    expect(daily[19]).toEqual({ day: 20, leads: null, sales: null, prevLeads: 0, prevSales: 0 });
    expect(daily[24]?.prevLeads).toBe(30);

    const running = trendSeries(november, october, {
      year: 2026,
      month: 11,
      through: 16,
      cumulative: true,
    });
    expect(running[2]).toEqual({ day: 3, leads: 35, sales: 5, prevLeads: 10, prevSales: 1 });
    expect(running[15]).toMatchObject({ day: 16, leads: 43, sales: 7 });
    expect(running[16]?.leads).toBeNull();
    expect(running[29]?.prevLeads).toBe(40);
  });

  it("breaks the month down by group with both halves and the direction", () => {
    const rows = trendBreakdown(november);
    expect(rows.map((r) => r.key)).toEqual(["724", "137"]);
    expect(rows[0]).toMatchObject({ leads: 36, sales: 5 });
    expect(rows[0]?.conversion).toBeCloseTo(5 / 36);
    expect(rows[0]?.firstHalf).toBeCloseTo(5 / 30);
    expect(rows[0]?.secondHalf).toBe(0);
    expect(rows[0]?.trend).toBe("down");
    // 137 converted nothing in days 1–15 and a quarter after.
    expect(rows[1]).toMatchObject({ firstHalf: 0, secondHalf: 0.25, trend: "up" });
    // A group with leads in one half only has no direction.
    expect(trendBreakdown([d("2026-11-02", "405", 5, 1)])[0]?.trend).toBeNull();
  });
});

describe("campaign creator (D5-07)", () => {
  const now = new Date("2026-11-16T12:00:00Z");

  it("turns a data period into a window and a label", () => {
    const thisMonth = creatorPeriod("this_month", now);
    expect(thisMonth.from.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(thisMonth.to.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(thisMonth.label).toBe("1 Nov 2026 – 16 Nov 2026");

    const lastMonth = creatorPeriod("last_month", now);
    expect(lastMonth.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(lastMonth.to.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(lastMonth.label).toBe("1 Oct 2026 – 31 Oct 2026");

    expect(creatorPeriod("last_3_months", now).from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(creatorPeriod("last_12_months", now).from.toISOString()).toBe(
      "2025-11-01T00:00:00.000Z",
    );
    expect(creatorPeriod("last_12_months", now).to.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  const offers = [
    { id: "o-rolling", name: "Rolling Slots" },
    { id: "o-trix", name: "Trixino" },
    { id: "o-lucky", name: "Lucky Reel" },
    { id: "o-new", name: "Brand New" },
  ];
  const period = [
    cell("GB", "o-rolling", {
      sent: 5_000,
      leads: 60,
      sales: 4,
      costMicro: 200n,
      revenueMicro: 1_200n,
    }),
    cell("GB", "o-trix", { sent: 3_000, leads: 20, sales: 6, costMicro: 120n, revenueMicro: 150n }),
    cell("ES", "o-rolling", {
      sent: 2_000,
      leads: 10,
      sales: 1,
      costMicro: 50n,
      revenueMicro: 300n,
    }),
  ];
  // Lucky Reel was sent to the UK before the period; Brand New never.
  const everSent = [...period, cell("GB", "o-lucky", { sent: 900 })];

  it("ranks the offers of a country by ROI and marks the ones never sent there", () => {
    const ranked = rankOffersForCountry(period, everSent, offers, "GB");
    expect(ranked.map((o) => o.offer)).toEqual([
      "Rolling Slots",
      "Trixino",
      "Lucky Reel",
      "Brand New",
    ]);
    expect(ranked[0]).toMatchObject({ offerId: "o-rolling", sales: 4, neverSent: false });
    expect(ranked[0]?.roi).toBeCloseTo(5);
    expect(ranked[0]?.leadToSale).toBeCloseTo(4 / 60);
    // Sent before the period: no figures, but not "never sent".
    expect(ranked[2]).toMatchObject({ roi: null, sales: 0, neverSent: false });
    expect(ranked[3]).toMatchObject({ offer: "Brand New", neverSent: true });
  });

  it("ranks the countries of an offer by ROI", () => {
    const ranked = rankCountriesForOffer(period, "o-rolling");
    expect(ranked.map((c) => c.country)).toEqual(["GB", "ES"]);
    expect(ranked[1]).toMatchObject({ country: "ES", sales: 1 });
    expect(rankCountriesForOffer(period, "o-new")).toEqual([]);
  });

  it("puts the lists never sent to the offer first, then the best sellers", () => {
    const lists = [
      { listId: "l1", name: "UK_ZEN_1", country: "GB", provider: "ZEN", numbersCount: 300 },
      { listId: "l2", name: "UK_DER_1", country: "GB", provider: "DER", numbersCount: 500 },
      { listId: "l3", name: "UK_ZEN_3", country: "GB", provider: "ZEN", numbersCount: 900 },
      { listId: "l4", name: "ES_DER_1", country: "ES", provider: "DER", numbersCount: 300 },
    ];
    const pair = (listId: string, sales: number, lastSentAt: string | null) => ({
      listId,
      offerId: "o-trix",
      sent: 100,
      sales,
      lastSentAt: lastSentAt ? new Date(lastSentAt) : null,
    });
    const ever = [
      pair("l1", 9, "2026-11-10T10:00:00Z"),
      pair("l2", 2, "2026-10-02T10:00:00Z"),
      { ...pair("l3", 0, "2026-09-01T10:00:00Z"), offerId: "o-rolling" },
    ];
    const inPeriod = [pair("l1", 3, "2026-11-10T10:00:00Z")];
    const ranked = rankListsForOffer(lists, ever, inPeriod, "o-trix", "GB");
    expect(ranked.map((l) => l.name)).toEqual(["UK_ZEN_3", "UK_ZEN_1", "UK_DER_1"]);
    expect(ranked[0]).toMatchObject({ neverSent: true, sales: 0, lastSentAt: null });
    expect(ranked[1]).toMatchObject({ neverSent: false, sales: 3 });
    expect(ranked[1]?.lastSentAt?.toISOString()).toBe("2026-11-10T10:00:00.000Z");
    // Sent before the period: its last send is known, its sales in the period are 0.
    expect(ranked[2]).toMatchObject({ neverSent: false, sales: 0 });
    expect(ranked[2]?.lastSentAt?.toISOString()).toBe("2026-10-02T10:00:00.000Z");
  });

  it("names a planned campaign after its offer and list", () => {
    expect(plannedCampaignName("Trixino", "UK_ZEN_3")).toBe("Trixino → UK_ZEN_3");
    expect(plannedCampaignName("x".repeat(100), "y".repeat(100))).toHaveLength(120);
  });

  it("validates what the creator sends", () => {
    const id = "0b8f5a2e-3c1d-4e6f-9a7b-1c2d3e4f5a6b";
    const ok = plannedCampaignSchema.safeParse({
      offerId: id,
      listId: id,
      routeId: id,
      plannedFor: "2026-11-17",
    });
    expect(ok.success).toBe(true);
    expect(
      plannedCampaignSchema.safeParse({ offerId: id, listId: id, routeId: id, plannedFor: "17/11" })
        .success,
    ).toBe(false);
    expect(
      plannedCampaignSchema.safeParse({
        offerId: "x",
        listId: id,
        routeId: id,
        plannedFor: "2026-11-17",
      }).success,
    ).toBe(false);
  });
});
