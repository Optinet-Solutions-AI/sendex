import { describe, expect, it } from "vitest";
import {
  bucketFor,
  compactNumber,
  countryStatus,
  cpsOverTime,
  cumulativeByCountry,
  foldSeries,
  insightCards,
  pivotMetrics,
  pivotTree,
  ROI_METRICS,
  SEND_BUCKETS,
} from "./dashboard.js";

describe("foldSeries", () => {
  it("keeps the top countries by total in fixed order and folds the rest into Other", () => {
    const rows = [
      { period: "2026-09", key: "ES", value: 100 },
      { period: "2026-09", key: "GB", value: 300 },
      { period: "2026-10", key: "GB", value: 50 },
      { period: "2026-10", key: "DE", value: 20 },
      { period: "2026-10", key: "FR", value: 10 },
    ];
    const folded = foldSeries(rows, 2);
    expect(folded.series).toEqual(["GB", "ES", "Other"]);
    expect(folded.periods).toEqual(["2026-09", "2026-10"]);
    expect(folded.rows).toEqual([
      { period: "2026-09", GB: 300, ES: 100, Other: 0 },
      { period: "2026-10", GB: 50, ES: 0, Other: 30 },
    ]);
  });

  it("has no Other series when everything fits", () => {
    const folded = foldSeries([{ period: "2026-09", key: "ES", value: 1 }], 8);
    expect(folded.series).toEqual(["ES"]);
    expect(folded.rows).toEqual([{ period: "2026-09", ES: 1 }]);
  });
});

const roiRows = [
  {
    country: "ES",
    link: "Trixino",
    list: "ES batch 1",
    month: "2026-10",
    cost: 100_000_000n,
    clicks: 50,
    leads: 10,
    sales: 2,
    revenue: 300_000_000n,
  },
  {
    country: "ES",
    link: "Trixino",
    list: "ES batch 2",
    month: "2026-10",
    cost: 50_000_000n,
    clicks: 10,
    leads: 0,
    sales: 0,
    revenue: 0n,
  },
  {
    country: "GB",
    link: "Gambiva",
    list: "GB batch 1",
    month: "2026-11",
    cost: 200_000_000n,
    clicks: 40,
    leads: 4,
    sales: 1,
    revenue: 100_000_000n,
  },
];

describe("pivotMetrics", () => {
  it("derives every metric and marks the ones it cannot compute", () => {
    const m = pivotMetrics({
      cost: 100_000_000n,
      clicks: 50,
      leads: 10,
      sales: 2,
      revenue: 300_000_000n,
    });
    expect(m.cpcMicro).toBe(2_000_000n);
    expect(m.cplMicro).toBe(10_000_000n);
    expect(m.cpsMicro).toBe(50_000_000n);
    expect(m.ctl).toBeCloseTo(0.2);
    expect(m.cts).toBeCloseTo(0.04);
    expect(m.lts).toBeCloseTo(0.2);
    expect(m.profitMicro).toBe(200_000_000n);
    expect(m.roi).toBeCloseTo(2);
    const empty = pivotMetrics({ cost: 0n, clicks: 0, leads: 0, sales: 0, revenue: 0n });
    expect(empty.cpcMicro).toBeNull();
    expect(empty.roi).toBeNull();
    expect(empty.ctl).toBeNull();
  });
});

describe("pivotTree", () => {
  it("nests rows by the chosen dimensions, sorted by cost, with a grand total", () => {
    const tree = pivotTree(roiRows, ["country", "link", "list"]);
    expect(tree.total.metrics.cost).toBe(350_000_000n);
    expect(tree.total.metrics.sales).toBe(3);
    expect(tree.nodes.map((n) => n.label)).toEqual(["GB", "ES"]);
    const es = tree.nodes[1];
    expect(es?.metrics.cost).toBe(150_000_000n);
    expect(es?.children.map((c) => c.label)).toEqual(["Trixino"]);
    expect(es?.children[0]?.children.map((c) => c.label)).toEqual(["ES batch 1", "ES batch 2"]);
    expect(es?.children[0]?.children[0]?.path).toEqual(["ES", "Trixino", "ES batch 1"]);
    expect(es?.children[0]?.children[1]?.children).toEqual([]);
  });

  it("groups by month when date is a dimension and sorts by any metric", () => {
    const tree = pivotTree(roiRows, ["date"], { sort: "sales", dir: "asc" });
    expect(tree.nodes.map((n) => n.label)).toEqual(["2026-11", "2026-10"]);
  });

  it("is one total row without dimensions", () => {
    const tree = pivotTree(roiRows, []);
    expect(tree.nodes).toEqual([]);
    expect(tree.total.metrics.clicks).toBe(100);
  });

  it("lists the metric catalogue with the defaults ticked", () => {
    expect(ROI_METRICS.filter((m) => m.default).map((m) => m.key)).toEqual([
      "cost",
      "clicks",
      "leads",
      "sales",
      "cpc",
      "cpl",
      "cps",
      "profit",
      "roi",
    ]);
  });
});

describe("cumulativeByCountry", () => {
  it("accumulates each country over the periods in order", () => {
    const rows = cumulativeByCountry([
      { period: "2026-09", key: "ES", value: 2 },
      { period: "2026-10", key: "GB", value: 1 },
      { period: "2026-10", key: "ES", value: 3 },
    ]);
    expect(rows).toEqual([
      { period: "2026-09", ES: 2, GB: 0 },
      { period: "2026-10", ES: 5, GB: 1 },
    ]);
  });
});

describe("cpsOverTime", () => {
  it("gives the monthly and the cumulative cost per sale", () => {
    const rows = cpsOverTime([
      { month: "2026-09", cost: 100_000_000n, sales: 2 },
      { month: "2026-10", cost: 60_000_000n, sales: 0 },
      { month: "2026-11", cost: 40_000_000n, sales: 2 },
    ]);
    expect(rows).toEqual([
      { month: "2026-09", monthlyCpsMicro: 50_000_000n, cumulativeCpsMicro: 50_000_000n },
      { month: "2026-10", monthlyCpsMicro: null, cumulativeCpsMicro: 80_000_000n },
      { month: "2026-11", monthlyCpsMicro: 20_000_000n, cumulativeCpsMicro: 50_000_000n },
    ]);
  });
});

describe("send buckets and country status", () => {
  it("buckets send counts the way the spec labels them", () => {
    expect(SEND_BUCKETS).toEqual(["0", "1–2", "3–5", "6–10", "11+"]);
    expect([0, 1, 2, 3, 5, 6, 10, 11, 40].map(bucketFor)).toEqual([
      "0",
      "1–2",
      "1–2",
      "3–5",
      "3–5",
      "6–10",
      "6–10",
      "11+",
      "11+",
    ]);
  });

  it("calls a country healthy from 50% utilisation", () => {
    expect(countryStatus(0.1)).toBe("under-worked");
    expect(countryStatus(0.5)).toBe("healthy");
    expect(countryStatus(3)).toBe("healthy");
  });
});

describe("insightCards", () => {
  const rows = [
    { country: "DE", contacts: 171_240, sent: 17_000, sales: 0, costMicro: 500_000_000n },
    { country: "GB", contacts: 17_000, sent: 54_000, sales: 10, costMicro: 816_700_000n },
    { country: "FR", contacts: 5_000, sent: 9_000, sales: 1, costMicro: 743_340_000n },
  ];

  it("names the biggest unused pool and the dearest cost per sale", () => {
    const cards = insightCards(rows);
    expect(cards.opportunity).toEqual({
      country: "DE",
      contacts: 171_240,
      utilisation: 17_000 / 171_240,
    });
    expect(cards.economics).toEqual([
      { country: "FR", cpsMicro: 743_340_000n },
      { country: "GB", cpsMicro: 81_670_000n },
    ]);
  });

  it("is empty without rows", () => {
    expect(insightCards([])).toEqual({ opportunity: null, economics: [] });
  });
});

describe("compactNumber", () => {
  it("compacts like the tiles (312k, 8k, 10, 1.2M)", () => {
    expect(compactNumber(312_400)).toBe("312k");
    expect(compactNumber(8_200)).toBe("8k");
    expect(compactNumber(10)).toBe("10");
    expect(compactNumber(1_250_000)).toBe("1.3M");
  });
});
