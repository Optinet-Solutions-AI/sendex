import { DAY_RULE_NOTE, FORMULAS, pivotMetrics } from "@sendex/core";
import { describe, expect, it } from "vitest";
import {
  assetRowFigures,
  balanceFigure,
  blendedCpsFigure,
  bucketCtrFigure,
  cpsChartFigures,
  ctrFigure,
  DASHBOARD_FORMULAS,
  economicsFigure,
  opportunityFigure,
  pctOfGoodFigure,
  perFigure,
  ROI_HEADER_FORMULAS,
  roiCell,
  roiFigure,
  roiTotalFigure,
  spendFigure,
  statusFigure,
  sumFigure,
  utilisationFigure,
} from "./explain";

const M = 1_000_000;

describe("spendFigure", () => {
  it("rounds to whole euros and shortens like the tile", () => {
    const f = spendFigure(1_234_560_000);
    expect(f.text).toBe("€1k");
    expect(f.formula).toBe(DASHBOARD_FORMULAS.spend);
    expect(f.working).toBe("€1,234.56, rounded to €1,235, shown as €1k");
  });

  it("only rounds under a thousand", () => {
    const f = spendFigure(123_450_000);
    expect(f.text).toBe("€123");
    expect(f.working).toBe("€123.45, rounded to whole euros = €123");
  });

  it("says when nothing was spent", () => {
    expect(spendFigure(0).working).toBe("No SMS sent in the period, so €0");
  });
});

describe("balanceFigure", () => {
  it("adds up the carriers' balances", () => {
    const f = balanceFigure({
      source: "carrier",
      totalMicro: 150 * M,
      carriers: [
        { name: "23Telecom", balanceMicro: 100 * M },
        { name: "Other", balanceMicro: 50 * M },
      ],
    });
    expect(f.text).toBe("€150.00");
    expect(f.formula).toBe(FORMULAS.balance);
    expect(f.working).toBe("€100.00 at 23Telecom + €50.00 at Other = €150.00");
  });

  it("falls back to the ledger when no carrier reports one", () => {
    const f = balanceFigure({ source: "ledger", totalMicro: 12 * M, carriers: [] });
    expect(f.formula).toBe(DASHBOARD_FORMULAS.balanceLedger);
    expect(f.working).toBe("Ledger entries added up = €12.00");
  });
});

describe("blendedCpsFigure", () => {
  it("divides spend by sales with the day rule", () => {
    const f = blendedCpsFigure(100 * M, 3, 33_333_333);
    expect(f.text).toBe("€33.33");
    expect(f.working).toBe("€100.00 spend ÷ 3 sales = €33.33");
    expect(f.note).toBe(DAY_RULE_NOTE);
  });

  it("explains the dash without sales", () => {
    const f = blendedCpsFigure(100 * M, 0, null);
    expect(f.text).toBe("—");
    expect(f.working).toBe("No sales in the period, so —");
  });
});

describe("ROI pivot", () => {
  const m = pivotMetrics({
    cost: 10n * 1_000_000n,
    clicks: 3,
    leads: 2,
    sales: 1,
    revenue: 250n * 1_000_000n,
  });

  it("has a formula on every header", () => {
    expect(ROI_HEADER_FORMULAS.cpc).toBe(FORMULAS.cpc);
    expect(ROI_HEADER_FORMULAS.roi).toBe(FORMULAS.roi);
    expect(Object.keys(ROI_HEADER_FORMULAS)).toHaveLength(12);
  });

  it("shows CPC truncated and rounded, working equal to the cell", () => {
    const f = roiFigure(m, "cpc");
    expect(f?.text).toBe("€3.33");
    expect(f?.text).toBe(roiCell(m, "cpc").text);
    expect(f?.working).toBe("€10.00 cost ÷ 3 clicks = €3.33");
  });

  it("explains profit and ROI with the revenue and the day rule", () => {
    expect(roiFigure(m, "profit")?.working).toBe("€250.00 revenue − €10.00 cost = €240.00");
    expect(roiFigure(m, "profit")?.note).toBe(DAY_RULE_NOTE);
    expect(roiFigure(m, "roi")?.working).toBe(
      "(€250.00 revenue − €10.00 cost) ÷ €10.00 cost = 2400%",
    );
  });

  it("gives the rates", () => {
    expect(roiFigure(m, "ctl")?.working).toBe("2 leads ÷ 3 clicks = 66.67%");
    expect(roiFigure(m, "cts")?.working).toBe("1 sale ÷ 3 clicks = 33.33%");
    expect(roiFigure(m, "lts")?.working).toBe("1 sale ÷ 2 leads = 50.00%");
  });

  it("says why a figure is a dash", () => {
    const empty = pivotMetrics({ cost: 0n, clicks: 0, leads: 0, sales: 0, revenue: 0n });
    expect(roiFigure(empty, "cpc")?.text).toBe("—");
    expect(roiFigure(empty, "cpc")?.working).toBe("No clicks yet, so —");
    expect(roiFigure(empty, "cps")?.working).toBe("No sales yet, so —");
    expect(roiFigure(empty, "lts")?.working).toBe("No leads yet, so —");
    expect(roiFigure(empty, "roi")?.working).toBe("No cost yet, so —");
  });

  it("leaves plain counts to the header", () => {
    expect(roiFigure(m, "clicks")).toBeNull();
    expect(roiFigure(m, "cost")).toBeNull();
  });

  it("adds up the rows in the Grand Total", () => {
    const a = pivotMetrics({ cost: 4n * 1_000_000n, clicks: 1, leads: 0, sales: 0, revenue: 0n });
    const b = pivotMetrics({
      cost: 6n * 1_000_000n,
      clicks: 2,
      leads: 2,
      sales: 1,
      revenue: 250n * 1_000_000n,
    });
    const f = roiTotalFigure(m, [a, b], "cost");
    expect(f.text).toBe("€10.00");
    expect(f.working).toBe("€4.00 + €6.00 = €10.00");
    expect(roiTotalFigure(m, [a, b], "cpc").working).toBe("€10.00 cost ÷ 3 clicks = €3.33");
    expect(roiTotalFigure(m, null, "clicks").working).toBeNull();
  });
});

describe("sumFigure", () => {
  it("names the count when there are many rows", () => {
    const parts = Array.from({ length: 12 }, () => "1");
    expect(sumFigure("Total = rows", parts, "12").working).toBe("12 rows added up = 12");
  });
});

describe("cpsChartFigures", () => {
  it("accumulates cost and sales month by month", () => {
    const [jan, feb] = cpsChartFigures([
      {
        month: "2026-01",
        costMicro: 10 * M,
        sales: 0,
        monthlyCpsMicro: null,
        cumulativeCpsMicro: null,
      },
      {
        month: "2026-02",
        costMicro: 20 * M,
        sales: 3,
        monthlyCpsMicro: 6_666_666,
        cumulativeCpsMicro: 10 * M,
      },
    ]);
    expect(jan?.monthly.working).toBe("No sales in Jan 2026, so —");
    expect(feb?.monthly.text).toBe("€6.67");
    expect(feb?.monthly.working).toBe("€20.00 cost ÷ 3 sales = €6.67");
    expect(feb?.cumulative.working).toBe("€30.00 cost ÷ 3 sales = €10.00");
    expect(feb?.cumulative.note).toBe(DAY_RULE_NOTE);
  });
});

describe("rates and per-unit figures", () => {
  it("CTR", () => {
    const f = ctrFigure(9, 190);
    expect(f.text).toBe("4.74%");
    expect(f.formula).toBe(FORMULAS.ctr);
    expect(f.working).toBe("9 clicks ÷ 190 sent = 4.74%");
    expect(ctrFigure(0, 0).working).toBe("No SMS sent, so 0.00%");
  });

  it("cost per sale as a float, rounded to the cent", () => {
    const f = perFigure(FORMULAS.costPerSale, 10 * M, 6, "sale", "cost", DAY_RULE_NOTE);
    expect(f.text).toBe("€1.67");
    expect(f.working).toBe("€10.00 cost ÷ 6 sales = €1.67");
    expect(perFigure(FORMULAS.cpc, 10 * M, 0, "click", "spend").working).toBe("No clicks, so —");
  });

  it("utilisation and status", () => {
    const u = utilisationFigure(2, 3);
    expect(u.text).toBe("67%");
    expect(u.working).toBe("2 sent ÷ 3 contacts = 67%");
    expect(utilisationFigure(5, 0).working).toBe("No contacts on file, so 0%");
    expect(statusFigure(2 / 3).working).toBe("Utilisation 66.67% is 50% or more, so Healthy");
    expect(statusFigure(0.25).working).toBe("Utilisation 25.00% is under 50%, so Under-worked");
  });

  it("opportunity and economics", () => {
    const o = opportunityFigure(1000, 200, 0.2);
    expect(o.text).toBe("1,000 contacts, 20% used");
    expect(o.working).toBe("200 sent ÷ 1,000 contacts = 20% used; 1,000 − 200 = 800 not used");
    const e = economicsFigure(10 * M, 3, 3_333_333);
    expect(e.text).toBe("€3.33 per sale");
    expect(e.working).toBe("€10.00 cost ÷ 3 sales = €3.33");
  });

  it("bucket CTR and % of good", () => {
    expect(bucketCtrFigure(1, 3).working).toBe("1 clicked ÷ 3 sent = 33.33%");
    expect(bucketCtrFigure(0, 0).working).toBe("No SMS sent to this group, so 0.00%");
    const g = pctOfGoodFigure(1, 3, 5);
    expect(g.text).toBe("33%");
    expect(g.working).toBe("1 sent fewer than 5 times ÷ 3 good contacts = 33%");
    expect(pctOfGoodFigure(0, 0, 5).working).toBe("No good contacts, so 0%");
  });

  it("asset row", () => {
    const f = assetRowFigures({ sent: 3, delivered: 2, clicks: 1, sales: 0, spendMicro: 10 * M });
    expect(f.delivered.text).toBe("66.7%");
    expect(f.delivered.working).toBe("2 delivered ÷ 3 sent = 66.7%");
    expect(f.cpc.working).toBe("€10.00 spend ÷ 1 click = €10.00");
    expect(f.costPerSale.text).toBe("—");
    expect(f.costPerSale.working).toBe("No sales, so —");
  });
});
