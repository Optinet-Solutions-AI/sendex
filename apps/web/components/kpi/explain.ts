import {
  DAY_RULE_NOTE,
  FORMULAS,
  formatEur,
  revenuePerSaleMicro,
  type TrendBreakdownRow,
  workingDivide,
  workingMinus,
  workingPerSale,
  workingSum,
} from "@sendex/core";
import { formatNumber } from "../../lib/format";
import { formatPricePerSms } from "../campaigns/format";
import { percent } from "./format";

/**
 * The hover explanations of the Performance screens (D5-20): for each computed figure, its
 * formula and the sum with the row's own numbers, formatted as the screen formats them so the
 * working ends on the figure shown. Spread into `Explained` from @sendex/ui.
 */
export interface Explanation {
  formula: string;
  working?: string;
  note?: string;
}

/** Wordings the shared FORMULAS do not have, for figures only the Performance screens show. */
export const KPI_FORMULAS = {
  leads: "Leads = registrations the tracker reported for the SMS sent",
  change: "Change = (This month − Month before) ÷ Month before, over the same days",
  conversionChange:
    "Change = This month's lead → sale − the month before's, in percentage points, over the same days",
  firstHalf: "Days 1–15 = Sales ÷ Leads of days 1 to 15",
  secondHalf: "Day 16–end = Sales ÷ Leads from day 16 to the end of the month",
  trend: "Trend = Day 16–end against Days 1–15: Better when higher, Worse when lower",
  planContacts: "Contacts = numbers in the lists attached to the day's campaigns, added up",
  groupContacts: "Contacts = numbers in the lists attached to the group's campaigns, added up",
  campaignContacts: "Contacts = numbers in the lists attached to the campaign",
  difference: "Difference = Contacts − Daily target",
} as const;

type Micro = bigint | string;

const money = (micro: Micro) => formatEur(BigInt(micro));
const count = (n: number, one: string, many: string) =>
  `${formatNumber(n)} ${n === 1 ? one : many}`;
const sales = (n: number) => count(n, "sale", "sales");
const leads = (n: number) => count(n, "lead", "leads");
const NO_SALES = "No sales yet, so nothing to divide by";

/** "+60.5%" or "-5.3 pts"; null when there is nothing to compare with. */
export function changeText(value: number | null, unit: "percent" | "points"): string | null {
  if (value === null) return null;
  const sign = value > 0 ? "+" : "";
  return unit === "percent"
    ? `${sign}${(value * 100).toFixed(1)}%`
    : `${sign}${value.toFixed(1)} pts`;
}

/** The daily plan's difference as its tile shows it: "+250", "-1,000", "–" without a target. */
export function differenceText(difference: number | null): string {
  if (difference === null) return "–";
  return `${difference > 0 ? "+" : ""}${formatNumber(difference)}`;
}

/** Lead → sale: "3 sales ÷ 20 leads = 15.0%". */
export function explainLeadToSale(
  n: { leads: number; sales: number; leadToSale: number | null },
  options: { digits?: number; empty?: string } = {},
): Explanation {
  return {
    formula: FORMULAS.lts,
    working: workingDivide(
      sales(n.sales),
      leads(n.leads),
      percent(n.leadToSale, options.digits ?? 1),
      {
        emptyWhen: n.leadToSale === null,
        empty: options.empty ?? "No leads yet, so no lead → sale",
      },
    ),
    note: DAY_RULE_NOTE,
  };
}

/** ROI: "(€100.00 revenue − €40.00 cost) ÷ €40.00 cost = 150.0%". */
export function explainRoi(
  n: { costMicro: Micro; revenueMicro: Micro; roi: number | null },
  options: { digits?: number; empty?: string } = {},
): Explanation {
  const cost = `${money(n.costMicro)} cost`;
  return {
    formula: FORMULAS.roi,
    working: workingDivide(
      `(${money(n.revenueMicro)} revenue − ${cost})`,
      cost,
      percent(n.roi, options.digits ?? 1),
      { emptyWhen: n.roi === null, empty: options.empty ?? "No cost yet, so no ROI" },
    ),
    note: DAY_RULE_NOTE,
  };
}

/** Net profit: "€16,720.00 revenue − €40.00 cost = €16,680.00". */
export function explainProfit(n: {
  costMicro: Micro;
  revenueMicro: Micro;
  profitMicro: Micro;
}): Explanation {
  return {
    formula: FORMULAS.profit,
    working: workingMinus(
      `${money(n.revenueMicro)} revenue`,
      `${money(n.costMicro)} cost`,
      money(n.profitMicro),
    ),
    note: DAY_RULE_NOTE,
  };
}

/** Cost: "1,000 SMS sent at €0.0123 on average = €12.30". */
export function explainCost(n: { sent: number; costMicro: Micro }): Explanation {
  const total = money(n.costMicro);
  return {
    formula: FORMULAS.cost,
    working:
      n.sent === 0
        ? `No SMS sent yet = ${total}`
        : `${formatNumber(n.sent)} SMS sent at ${formatPricePerSms(Number(BigInt(n.costMicro)) / n.sent)} on average = ${total}`,
  };
}

/** Revenue: "36 first deposits, on average €240.00 each = €8,640.00". */
export function explainRevenue(n: { sales: number; revenueMicro: Micro }): Explanation {
  const perSale = revenuePerSaleMicro({ sales: n.sales, revenueMicro: BigInt(n.revenueMicro) });
  return {
    formula: FORMULAS.revenue,
    working: workingPerSale(n.sales, money(n.revenueMicro), perSale === null ? "" : money(perSale)),
  };
}

/** Cost per sale: "€10.00 cost ÷ 3 sales = €3.33". */
export function explainCostPerSale(n: {
  sales: number;
  costMicro: Micro;
  costPerSaleMicro: Micro | null;
}): Explanation {
  return {
    formula: FORMULAS.costPerSale,
    working: workingDivide(
      `${money(n.costMicro)} cost`,
      sales(n.sales),
      n.costPerSaleMicro === null ? "–" : money(n.costPerSaleMicro),
      { emptyWhen: n.costPerSaleMicro === null, empty: NO_SALES },
    ),
    note: DAY_RULE_NOTE,
  };
}

/** Revenue per sale: "€5.00 revenue ÷ 3 sales = €1.67" (both on the deposit day). */
export function explainRevenuePerSale(n: {
  sales: number;
  revenueMicro: Micro;
  revenuePerSaleMicro: Micro | null;
}): Explanation {
  return {
    formula: FORMULAS.revenuePerSale,
    working: workingDivide(
      `${money(n.revenueMicro)} revenue`,
      sales(n.sales),
      n.revenuePerSaleMicro === null ? "–" : money(n.revenuePerSaleMicro),
      { emptyWhen: n.revenuePerSaleMicro === null, empty: NO_SALES },
    ),
  };
}

/** Profit per sale: "(€5.00 revenue − €10.00 cost) ÷ 3 sales = -€1.67". */
export function explainProfitPerSale(n: {
  sales: number;
  costMicro: Micro;
  revenueMicro: Micro;
  profitPerSaleMicro: Micro | null;
}): Explanation {
  return {
    formula: FORMULAS.profitPerSale,
    working: workingDivide(
      `(${money(n.revenueMicro)} revenue − ${money(n.costMicro)} cost)`,
      sales(n.sales),
      n.profitPerSaleMicro === null ? "–" : money(n.profitPerSaleMicro),
      { emptyWhen: n.profitPerSaleMicro === null, empty: NO_SALES },
    ),
    note: DAY_RULE_NOTE,
  };
}

/** SMS per sale: "1,000 SMS sent ÷ 3 sales = 333", rounded to a whole SMS. */
export function explainSmsPerSale(n: {
  sent: number;
  sales: number;
  smsPerSale: number | null;
}): Explanation {
  return {
    formula: FORMULAS.smsPerSale,
    working: workingDivide(
      `${formatNumber(n.sent)} SMS sent`,
      sales(n.sales),
      n.smsPerSale === null ? "–" : formatNumber(n.smsPerSale),
      { emptyWhen: n.smsPerSale === null, empty: NO_SALES },
    ),
    note: `Rounded to a whole SMS. ${DAY_RULE_NOTE}`,
  };
}

/** Trends' change of leads or sales against the same days of the month before. */
export function explainChange(n: {
  now: number;
  before: number;
  change: number | null;
  noun: "leads" | "sales";
}): Explanation {
  const now = formatNumber(n.now);
  const before = formatNumber(n.before);
  return {
    formula: KPI_FORMULAS.change,
    working:
      n.change === null
        ? `No ${n.noun} in the same days of the month before, so no change`
        : `${now} ${n.noun} against ${before} the month before: (${now} − ${before}) ÷ ${before} = ${changeText(n.change, "percent")}`,
  };
}

/** Trends' change of the lead → sale, in percentage points. */
export function explainConversionChange(n: {
  now: number | null;
  before: number | null;
  points: number | null;
}): Explanation {
  return {
    formula: KPI_FORMULAS.conversionChange,
    working:
      n.points === null
        ? n.now === null
          ? "No lead → sale this month yet, so no change"
          : "No lead → sale in the same days of the month before, so no change"
        : workingMinus(
            `${percent(n.now)} this month`,
            `${percent(n.before)} the month before`,
            changeText(n.points, "points") ?? "–",
          ),
  };
}

/** The lead → sale of one half of the month in the Trends breakdown. */
export function explainHalf(
  half: "first" | "second",
  n: { leads: number; sales: number; rate: number | null },
): Explanation {
  return {
    formula: half === "first" ? KPI_FORMULAS.firstHalf : KPI_FORMULAS.secondHalf,
    working: workingDivide(sales(n.sales), leads(n.leads), percent(n.rate), {
      emptyWhen: n.rate === null,
      empty: half === "first" ? "No leads in days 1 to 15" : "No leads from day 16 on",
    }),
    note: DAY_RULE_NOTE,
  };
}

const TREND_WORDS = { up: "Better", down: "Worse", flat: "Same" } as const;

/** The Trends arrow: the second half's lead → sale against the first's. */
export function explainTrend(n: {
  first: number | null;
  second: number | null;
  trend: TrendBreakdownRow["trend"];
}): Explanation {
  if (n.trend === null || n.first === null || n.second === null) {
    return {
      formula: KPI_FORMULAS.trend,
      working: "A half of the month has no leads, so no trend",
    };
  }
  // Two halves that round to the same 0.1 % but differ get more digits, so the word adds up.
  const tie = percent(n.first) === percent(n.second) && n.trend !== "flat";
  const digits = tie ? 3 : 1;
  return {
    formula: KPI_FORMULAS.trend,
    working: `${percent(n.second, digits)} from day 16 against ${percent(n.first, digits)} in days 1 to 15 = ${TREND_WORDS[n.trend]}`,
  };
}

/** More campaigns than this and the working names the count instead of every term. */
const MAX_TERMS = 8;

/** The daily plan's contacts: "1,000 + 2,500 = 3,500". */
export function explainPlanContacts(parts: readonly number[], total: number): Explanation {
  return {
    formula: KPI_FORMULAS.planContacts,
    working:
      parts.length > MAX_TERMS
        ? `The lists of ${formatNumber(parts.length)} campaigns added up = ${formatNumber(total)}`
        : workingSum(parts.map(formatNumber), formatNumber(total)),
  };
}

/** The daily plan's difference: "9,000 contacts − 10,000 target = -1,000". */
export function explainDifference(n: {
  contacts: number;
  target: number | null;
  difference: number | null;
}): Explanation {
  return {
    formula: KPI_FORMULAS.difference,
    working:
      n.target === null || n.difference === null
        ? "No daily target set"
        : workingMinus(
            `${formatNumber(n.contacts)} contacts`,
            `${formatNumber(n.target)} target`,
            differenceText(n.difference),
          ),
  };
}
