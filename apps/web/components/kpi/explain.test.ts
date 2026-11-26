import {
  costPerSaleMicro,
  DAY_RULE_NOTE,
  FORMULAS,
  leadToSale,
  profitPerSaleMicro,
  revenuePerSaleMicro,
  roi,
  smsPerSale,
} from "@sendex/core";
import { describe, expect, it } from "vitest";
import {
  changeText,
  differenceText,
  explainChange,
  explainConversionChange,
  explainCost,
  explainCostPerSale,
  explainDifference,
  explainHalf,
  explainLeadToSale,
  explainPlanContacts,
  explainProfit,
  explainProfitPerSale,
  explainRevenue,
  explainRevenuePerSale,
  explainRoi,
  explainSmsPerSale,
  explainTrend,
  KPI_FORMULAS,
} from "./explain";
import { eur, percent } from "./format";

/** The result a working ends on: what follows its last " = ". */
const resultOf = (working: string | undefined) => working?.split(" = ").at(-1);

describe("explainLeadToSale", () => {
  it("divides sales by leads with the numbers of the row", () => {
    const n = { leads: 20, sales: 3, leadToSale: leadToSale({ leads: 20, sales: 3 }) };
    expect(explainLeadToSale(n)).toEqual({
      formula: FORMULAS.lts,
      working: "3 sales ÷ 20 leads = 15.0%",
      note: DAY_RULE_NOTE,
    });
  });

  it("ends on the figure shown, rounding included", () => {
    const n = { leads: 3, sales: 1, leadToSale: leadToSale({ leads: 3, sales: 1 }) };
    const working = explainLeadToSale(n).working;
    expect(working).toBe("1 sale ÷ 3 leads = 33.3%");
    expect(resultOf(working)).toBe(percent(n.leadToSale));
  });

  it("says why there is no figure without leads", () => {
    expect(explainLeadToSale({ leads: 0, sales: 2, leadToSale: null }).working).toBe(
      "No leads yet, so no lead → sale",
    );
  });

  it("takes the digits and the reason for no figure from the caller", () => {
    const n = { leads: 3, sales: 1, leadToSale: leadToSale({ leads: 3, sales: 1 }) };
    expect(resultOf(explainLeadToSale(n, { digits: 0 }).working)).toBe("33%");
    expect(
      explainLeadToSale(
        { leads: 0, sales: 0, leadToSale: null },
        { empty: "Not sent there in this period" },
      ).working,
    ).toBe("Not sent there in this period");
  });

  it("groups thousands as the table does", () => {
    const n = {
      leads: 12_000,
      sales: 1_500,
      leadToSale: leadToSale({ leads: 12_000, sales: 1_500 }),
    };
    expect(explainLeadToSale(n).working).toBe("1,500 sales ÷ 12,000 leads = 12.5%");
  });
});

describe("explainRoi", () => {
  it("divides the profit by the cost", () => {
    const c = { costMicro: "40000000", revenueMicro: "100000000" };
    const value = roi({ costMicro: 40_000_000n, revenueMicro: 100_000_000n });
    expect(explainRoi({ ...c, roi: value })).toEqual({
      formula: FORMULAS.roi,
      working: "(€100.00 revenue − €40.00 cost) ÷ €40.00 cost = 150.0%",
      note: DAY_RULE_NOTE,
    });
  });

  it("ends on the figure shown, to the digits the screen uses", () => {
    const value = roi({ costMicro: 3_000_000n, revenueMicro: 4_000_000n });
    const n = { costMicro: 3_000_000n, revenueMicro: 4_000_000n, roi: value };
    expect(resultOf(explainRoi(n).working)).toBe(percent(value));
    expect(resultOf(explainRoi(n, { digits: 0 }).working)).toBe("33%");
  });

  it("says why there is no figure without cost, or the reason given", () => {
    const n = { costMicro: "0", revenueMicro: "5000000", roi: null };
    expect(explainRoi(n).working).toBe("No cost yet, so no ROI");
    expect(explainRoi(n, { empty: "Not sent there in this period" }).working).toBe(
      "Not sent there in this period",
    );
  });
});

describe("explainProfit", () => {
  it("takes the cost from the revenue", () => {
    expect(
      explainProfit({
        costMicro: "40000000",
        revenueMicro: "16720000000",
        profitMicro: "16680000000",
      }),
    ).toEqual({
      formula: FORMULAS.profit,
      working: "€16,720.00 revenue − €40.00 cost = €16,680.00",
      note: DAY_RULE_NOTE,
    });
  });

  it("shows a loss with its sign", () => {
    expect(
      explainProfit({ costMicro: "50000000", revenueMicro: "20000000", profitMicro: "-30000000" })
        .working,
    ).toBe("€20.00 revenue − €50.00 cost = -€30.00");
  });
});

describe("explainCost", () => {
  it("shows the SMS sent and their average price", () => {
    expect(explainCost({ sent: 1_000, costMicro: "12300000" })).toEqual({
      formula: FORMULAS.cost,
      working: "1,000 SMS sent at €0.0123 on average = €12.30",
    });
  });

  it("says when nothing was sent", () => {
    expect(explainCost({ sent: 0, costMicro: "0" }).working).toBe("No SMS sent yet = €0.00");
  });
});

describe("explainRevenue", () => {
  it("shows the first deposits and what each earned on average", () => {
    expect(explainRevenue({ sales: 36, revenueMicro: "8640000000" })).toEqual({
      formula: FORMULAS.revenue,
      working: "36 first deposits, on average €240.00 each = €8,640.00",
    });
  });

  it("says when there are no first deposits", () => {
    expect(explainRevenue({ sales: 0, revenueMicro: "0" }).working).toBe("No first deposits yet");
  });
});

describe("per-sale figures", () => {
  const counters = { sales: 3, costMicro: 10_000_000n, revenueMicro: 5_000_000n, sent: 1_000 };

  it("cost per sale ends on the figure shown (micro-EUR division, then cents)", () => {
    const perSale = costPerSaleMicro(counters);
    const e = explainCostPerSale({ ...counters, costPerSaleMicro: perSale });
    expect(e.formula).toBe(FORMULAS.costPerSale);
    expect(e.note).toBe(DAY_RULE_NOTE);
    expect(e.working).toBe("€10.00 cost ÷ 3 sales = €3.33");
    expect(resultOf(e.working)).toBe(eur(perSale?.toString() ?? null));
  });

  it("revenue per sale", () => {
    const perSale = revenuePerSaleMicro(counters);
    const e = explainRevenuePerSale({ ...counters, revenuePerSaleMicro: perSale });
    expect(e.formula).toBe(FORMULAS.revenuePerSale);
    expect(e.working).toBe("€5.00 revenue ÷ 3 sales = €1.67");
  });

  it("profit per sale, a loss", () => {
    const perSale = profitPerSaleMicro(counters);
    const e = explainProfitPerSale({ ...counters, profitPerSaleMicro: perSale });
    expect(e.formula).toBe(FORMULAS.profitPerSale);
    expect(e.note).toBe(DAY_RULE_NOTE);
    expect(e.working).toBe("(€5.00 revenue − €10.00 cost) ÷ 3 sales = -€1.67");
    expect(resultOf(e.working)).toBe(eur(perSale?.toString() ?? null));
  });

  it("SMS per sale is rounded to a whole SMS", () => {
    const e = explainSmsPerSale({ sent: 1_000, sales: 3, smsPerSale: smsPerSale(counters) });
    expect(e.formula).toBe(FORMULAS.smsPerSale);
    expect(e.working).toBe("1,000 SMS sent ÷ 3 sales = 333");
    expect(e.note).toContain("Rounded to a whole SMS");
    expect(e.note).toContain(DAY_RULE_NOTE);
  });

  it("says why there is no figure without sales", () => {
    const none = { sent: 50, sales: 0, costMicro: "1000000", revenueMicro: "0" };
    expect(explainCostPerSale({ ...none, costPerSaleMicro: null }).working).toBe(
      "No sales yet, so nothing to divide by",
    );
    expect(explainRevenuePerSale({ ...none, revenuePerSaleMicro: null }).working).toBe(
      "No sales yet, so nothing to divide by",
    );
    expect(explainProfitPerSale({ ...none, profitPerSaleMicro: null }).working).toBe(
      "No sales yet, so nothing to divide by",
    );
    expect(explainSmsPerSale({ ...none, smsPerSale: null }).working).toBe(
      "No sales yet, so nothing to divide by",
    );
  });
});

describe("Trends", () => {
  it("changeText prints a signed change", () => {
    expect(changeText(0.605, "percent")).toBe("+60.5%");
    expect(changeText(-5.25, "points")).toBe("-5.3 pts");
    expect(changeText(null, "percent")).toBeNull();
  });

  it("explains the change against the same days of the month before", () => {
    expect(explainChange({ now: 1_234, before: 1_000, change: 0.234, noun: "leads" })).toEqual({
      formula: KPI_FORMULAS.change,
      working: "1,234 leads against 1,000 the month before: (1,234 − 1,000) ÷ 1,000 = +23.4%",
    });
    expect(explainChange({ now: 4, before: 0, change: null, noun: "sales" }).working).toBe(
      "No sales in the same days of the month before, so no change",
    );
  });

  it("explains the change of the conversion in points", () => {
    const e = explainConversionChange({ now: 0.16, before: 0.125, points: 3.5 });
    expect(e.formula).toBe(KPI_FORMULAS.conversionChange);
    expect(e.working).toBe("16.0% this month − 12.5% the month before = +3.5 pts");
    expect(explainConversionChange({ now: 0.16, before: null, points: null }).working).toBe(
      "No lead → sale in the same days of the month before, so no change",
    );
    expect(explainConversionChange({ now: null, before: 0.1, points: null }).working).toBe(
      "No lead → sale this month yet, so no change",
    );
  });

  it("explains each half of the month", () => {
    expect(explainHalf("first", { leads: 8, sales: 1, rate: 1 / 8 })).toEqual({
      formula: KPI_FORMULAS.firstHalf,
      working: "1 sale ÷ 8 leads = 12.5%",
      note: DAY_RULE_NOTE,
    });
    expect(explainHalf("second", { leads: 0, sales: 0, rate: null }).working).toBe(
      "No leads from day 16 on",
    );
    expect(explainHalf("first", { leads: 0, sales: 1, rate: null }).working).toBe(
      "No leads in days 1 to 15",
    );
  });

  it("explains the trend arrow", () => {
    expect(explainTrend({ first: 0.1, second: 0.125, trend: "up" })).toEqual({
      formula: KPI_FORMULAS.trend,
      working: "12.5% from day 16 against 10.0% in days 1 to 15 = Better",
    });
    expect(explainTrend({ first: null, second: 0.2, trend: null }).working).toBe(
      "A half of the month has no leads, so no trend",
    );
  });

  it("shows more digits when the rounded halves look the same but differ", () => {
    expect(explainTrend({ first: 0.15004, second: 0.15001, trend: "down" }).working).toBe(
      "15.001% from day 16 against 15.004% in days 1 to 15 = Worse",
    );
  });
});

describe("Daily plan", () => {
  it("adds up the contacts of the day's campaigns", () => {
    expect(explainPlanContacts([1_000, 2_500], 3_500)).toEqual({
      formula: KPI_FORMULAS.planContacts,
      working: "1,000 + 2,500 = 3,500",
    });
    expect(explainPlanContacts([], 0).working).toBe("Nothing yet = 0");
  });

  it("keeps a long day short", () => {
    const parts = Array.from({ length: 12 }, () => 100);
    expect(explainPlanContacts(parts, 1_200).working).toBe(
      "The lists of 12 campaigns added up = 1,200",
    );
  });

  it("differenceText signs the difference as the tile does", () => {
    expect(differenceText(250)).toBe("+250");
    expect(differenceText(-1_000)).toBe("-1,000");
    expect(differenceText(0)).toBe("0");
    expect(differenceText(null)).toBe("–");
  });

  it("explains the difference with the target, ending on the tile's figure", () => {
    const e = explainDifference({ contacts: 9_000, target: 10_000, difference: -1_000 });
    expect(e.formula).toBe(KPI_FORMULAS.difference);
    expect(e.working).toBe("9,000 contacts − 10,000 target = -1,000");
    expect(resultOf(e.working)).toBe(differenceText(-1_000));
    expect(explainDifference({ contacts: 9_000, target: null, difference: null }).working).toBe(
      "No daily target set",
    );
  });
});
