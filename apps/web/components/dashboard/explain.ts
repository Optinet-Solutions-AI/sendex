import {
  compactNumber,
  countryStatus,
  DAY_RULE_NOTE,
  FORMULAS,
  HEALTHY_UTILISATION,
  type PivotMetricKey,
  type PivotMetrics,
  workingDivide,
  workingMinus,
  workingSum,
} from "@sendex/core";
import { eur, int, monthLabel, pct } from "./format";

/**
 * The hover explanations of the SMS Dashboard's computed figures (D5-20). Each figure is
 * built here with the text the screen shows, so the working's result is that text exactly,
 * rounding included. The workings use the numbers the screen already has.
 */

export interface Figure {
  /** What the screen shows. */
  text: string;
  formula: string;
  working: string | null;
  note: string | null;
}

/** Wordings this screen needs that are not (or not exactly) in @sendex/core's FORMULAS. */
export const DASHBOARD_FORMULAS = {
  cost: "Cost = what each SMS sent cost (its ledger debit), added up",
  spend: "Spend = what each SMS sent cost (its ledger debit), added up, in whole euros",
  leads: "Leads = lead postbacks from your tracker on the SMS sent",
  signupsRaw: "Signups = lead postbacks from your tracker on the SMS sent",
  signupsUnique: "Signups = contacts with at least one lead",
  contactsInPeriod: "Contacts on file = contacts added in the period",
  contactsAllTime: "Contacts = contacts on file in the country, whatever the period",
  blendedCps: "Blended cost / sale = Spend ÷ Sales (first deposits)",
  utilisation: "Utilisation = Sent ÷ Contacts on file",
  status: "Healthy when Utilisation is 50% or more, otherwise Under-worked",
  opportunity:
    "Biggest opportunity = the Under-worked country with the most unused contacts: Contacts × (1 − Utilisation)",
  economics: "Review economics = countries with sales, dearest Cost ÷ Sales first",
  monthlyCps: "Monthly cost per sale = Cost in the month ÷ Sales in the month",
  cumulativeCps: "Cumulative cost per sale = Cost so far ÷ Sales so far",
  bucketCtr: "CTR = SMS clicked ÷ SMS sent to the contacts in the group (all time)",
  pctOfGood: "% of good = Good contacts sent fewer than the threshold ÷ Good contacts",
  previews: "Previews = link opens by bots and link scanners (left out of Clicks)",
  balanceLedger:
    "Balance = your Sendex ledger, added up (no carrier reports a balance on your routes)",
  total: "Total = the rows above added up",
} as const;

/** Above this many rows a sum names the count instead of listing every row. */
const MAX_SUM_PARTS = 8;

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${int(n)} ${n === 1 ? singular : plural}`;
}

function figure(text: string, formula: string, working: string | null, note?: string): Figure {
  return { text, formula, working, note: note ?? null };
}

/** A total of rows: "€4.00 + €6.00 = €10.00", or "12 rows added up = 12" when long. */
export function sumFigure(formula: string, parts: readonly string[], result: string): Figure {
  const working =
    parts.length > MAX_SUM_PARTS
      ? `${parts.length} rows added up = ${result}`
      : workingSum(parts, result);
  return figure(result, formula, working);
}

// ---------------------------------------------------------------------------
// Tiles (Getting Started, Overview)
// ---------------------------------------------------------------------------

/** The Spend tile: whole euros, shortened (€1k, €1.3M). */
export function spendFigure(spendMicro: number): Figure {
  const rounded = Math.round(spendMicro / 1_000_000);
  const text = `€${compactNumber(rounded)}`;
  let working: string;
  if (spendMicro === 0) working = `No SMS sent in the period, so ${text}`;
  else if (rounded >= 1_000)
    working = `${eur(spendMicro)}, rounded to €${int(rounded)}, shown as ${text}`;
  else working = `${eur(spendMicro)}, rounded to whole euros = ${text}`;
  return figure(text, DASHBOARD_FORMULAS.spend, working);
}

export interface BalanceInput {
  source: "carrier" | "ledger";
  totalMicro: number;
  carriers: ReadonlyArray<{ name: string; balanceMicro: number }>;
}

export function balanceFigure({ source, totalMicro, carriers }: BalanceInput): Figure {
  const text = eur(totalMicro);
  if (source === "ledger") {
    return figure(text, DASHBOARD_FORMULAS.balanceLedger, `Ledger entries added up = ${text}`);
  }
  return figure(
    text,
    FORMULAS.balance,
    workingSum(
      carriers.map((c) => `${eur(c.balanceMicro)} at ${c.name}`),
      text,
    ),
  );
}

/** Blended cost / sale: spend over sales, both in the window (bigint, truncated). */
export function blendedCpsFigure(
  spendMicro: number,
  sales: number,
  blendedCpsMicro: number | null,
): Figure {
  const text = eur(blendedCpsMicro);
  return figure(
    text,
    DASHBOARD_FORMULAS.blendedCps,
    workingDivide(`${eur(spendMicro)} spend`, count(sales, "sale"), text, {
      emptyWhen: sales === 0 || blendedCpsMicro === null,
      empty: `No sales in the period, so ${text}`,
    }),
    DAY_RULE_NOTE,
  );
}

// ---------------------------------------------------------------------------
// ROI pivot
// ---------------------------------------------------------------------------

export const ROI_HEADER_FORMULAS: Record<PivotMetricKey, string> = {
  cost: DASHBOARD_FORMULAS.cost,
  clicks: FORMULAS.clicks,
  leads: DASHBOARD_FORMULAS.leads,
  sales: FORMULAS.sales,
  cpc: FORMULAS.cpc,
  cpl: FORMULAS.cpl,
  cps: FORMULAS.cps,
  ctl: FORMULAS.ctl,
  cts: FORMULAS.cts,
  lts: FORMULAS.lts,
  profit: FORMULAS.profit,
  roi: FORMULAS.roi,
};

/** A pivot cell as the table and the CSV show it. */
export function roiCell(m: PivotMetrics, key: PivotMetricKey): { text: string; negative: boolean } {
  switch (key) {
    case "cost":
      return { text: eur(Number(m.cost)), negative: false };
    case "clicks":
      return { text: m.clicks.toLocaleString("en-GB"), negative: false };
    case "leads":
      return { text: m.leads.toLocaleString("en-GB"), negative: false };
    case "sales":
      return { text: m.sales.toLocaleString("en-GB"), negative: false };
    case "cpc":
      return { text: m.cpcMicro === null ? "—" : eur(Number(m.cpcMicro)), negative: false };
    case "cpl":
      return { text: m.cplMicro === null ? "—" : eur(Number(m.cplMicro)), negative: false };
    case "cps":
      return { text: m.cpsMicro === null ? "—" : eur(Number(m.cpsMicro)), negative: false };
    case "ctl":
      return { text: pct(m.ctl), negative: false };
    case "cts":
      return { text: pct(m.cts), negative: false };
    case "lts":
      return { text: pct(m.lts), negative: false };
    case "profit":
      return { text: eur(Number(m.profitMicro)), negative: m.profitMicro < 0n };
    case "roi":
      return { text: m.roi === null ? "—" : pct(m.roi, 0), negative: m.roi !== null && m.roi < 0 };
  }
}

/** A derived pivot cell explained; null for the plain counts (their header explains them). */
export function roiFigure(m: PivotMetrics, key: PivotMetricKey): Figure | null {
  const text = roiCell(m, key).text;
  const formula = ROI_HEADER_FORMULAS[key];
  const cost = `${eur(Number(m.cost))} cost`;
  const revenue = `${eur(Number(m.revenue))} revenue`;
  const clicks = count(m.clicks, "click");
  const leads = count(m.leads, "lead");
  const sales = count(m.sales, "sale");
  const noClicks = { emptyWhen: m.clicks === 0, empty: `No clicks yet, so ${text}` };
  const noLeads = { emptyWhen: m.leads === 0, empty: `No leads yet, so ${text}` };
  const noSales = { emptyWhen: m.sales === 0, empty: `No sales yet, so ${text}` };
  switch (key) {
    case "cost":
    case "clicks":
    case "leads":
    case "sales":
      return null;
    case "cpc":
      return figure(text, formula, workingDivide(cost, clicks, text, noClicks));
    case "cpl":
      return figure(text, formula, workingDivide(cost, leads, text, noLeads));
    case "cps":
      return figure(text, formula, workingDivide(cost, sales, text, noSales), DAY_RULE_NOTE);
    case "ctl":
      return figure(text, formula, workingDivide(leads, clicks, text, noClicks));
    case "cts":
      return figure(text, formula, workingDivide(sales, clicks, text, noClicks), DAY_RULE_NOTE);
    case "lts":
      return figure(text, formula, workingDivide(sales, leads, text, noLeads), DAY_RULE_NOTE);
    case "profit":
      return figure(text, formula, workingMinus(revenue, cost, text), DAY_RULE_NOTE);
    case "roi":
      return figure(
        text,
        formula,
        workingDivide(`(${revenue} − ${cost})`, cost, text, {
          emptyWhen: m.cost <= 0n,
          empty: `No cost yet, so ${text}`,
        }),
        DAY_RULE_NOTE,
      );
  }
}

/**
 * A Grand Total cell: the plain counts add up the top-level rows (`parts`, null when the
 * pivot has no rows to show); the derived figures are worked out from the totals.
 */
export function roiTotalFigure(
  total: PivotMetrics,
  parts: readonly PivotMetrics[] | null,
  key: PivotMetricKey,
): Figure {
  const derived = roiFigure(total, key);
  if (derived) return derived;
  const text = roiCell(total, key).text;
  if (parts === null) return figure(text, ROI_HEADER_FORMULAS[key], null);
  return sumFigure(
    ROI_HEADER_FORMULAS[key],
    parts.map((p) => roiCell(p, key).text),
    text,
  );
}

export interface CpsChartPoint {
  month: string;
  costMicro: number;
  sales: number;
  monthlyCpsMicro: number | null;
  cumulativeCpsMicro: number | null;
}

/** The cost-per-sale chart's table cells, cost and sales accumulated in month order. */
export function cpsChartFigures(
  points: readonly CpsChartPoint[],
): Array<{ monthly: Figure; cumulative: Figure }> {
  let costSoFar = 0;
  let salesSoFar = 0;
  return points.map((p) => {
    costSoFar += p.costMicro;
    salesSoFar += p.sales;
    const month = monthLabel(p.month);
    const monthly = eur(p.monthlyCpsMicro);
    const cumulative = eur(p.cumulativeCpsMicro);
    return {
      monthly: figure(
        monthly,
        DASHBOARD_FORMULAS.monthlyCps,
        workingDivide(`${eur(p.costMicro)} cost`, count(p.sales, "sale"), monthly, {
          emptyWhen: p.sales === 0 || p.monthlyCpsMicro === null,
          empty: `No sales in ${month}, so ${monthly}`,
        }),
        DAY_RULE_NOTE,
      ),
      cumulative: figure(
        cumulative,
        DASHBOARD_FORMULAS.cumulativeCps,
        workingDivide(`${eur(costSoFar)} cost`, count(salesSoFar, "sale"), cumulative, {
          emptyWhen: salesSoFar === 0 || p.cumulativeCpsMicro === null,
          empty: `No sales up to ${month}, so ${cumulative}`,
        }),
        DAY_RULE_NOTE,
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Rates and per-unit figures (Countries, Contacts, Assets, API Usage)
// ---------------------------------------------------------------------------

/** CTR as the tables show it: 0.00% (not a dash) when nothing was sent. */
export function ctrFigure(clicks: number, sent: number): Figure {
  const text = pct(sent > 0 ? clicks / sent : 0);
  return figure(
    text,
    FORMULAS.ctr,
    workingDivide(count(clicks, "click"), `${int(sent)} sent`, text, {
      emptyWhen: sent === 0,
      empty: `No SMS sent, so ${text}`,
    }),
  );
}

/** Money over a count as a float, rounded to the cent: "€10.00 cost ÷ 6 sales = €1.67". */
export function perFigure(
  formula: string,
  micro: number,
  n: number,
  unit: string,
  moneyLabel: string,
  note?: string,
): Figure {
  const text = n > 0 ? eur(micro / n) : "—";
  return figure(
    text,
    formula,
    workingDivide(`${eur(micro)} ${moneyLabel}`, count(n, unit), text, {
      emptyWhen: n === 0,
      empty: `No ${unit}s, so ${text}`,
    }),
    note,
  );
}

export function utilisationFigure(sent: number, contacts: number): Figure {
  const text = pct(contacts > 0 ? sent / contacts : 0, 0);
  return figure(
    text,
    DASHBOARD_FORMULAS.utilisation,
    workingDivide(`${int(sent)} sent`, `${int(contacts)} contacts`, text, {
      emptyWhen: contacts === 0,
      empty: `No contacts on file, so ${text}`,
    }),
  );
}

export function statusFigure(utilisation: number): Figure {
  const healthy = countryStatus(utilisation) === "healthy";
  const text = healthy ? "Healthy" : "Under-worked";
  const threshold = pct(HEALTHY_UTILISATION, 0);
  return figure(
    text,
    DASHBOARD_FORMULAS.status,
    `Utilisation ${pct(utilisation)} is ${healthy ? `${threshold} or more` : `under ${threshold}`}, so ${text}`,
  );
}

/** The "Biggest opportunity" card: unused = Contacts × (1 − Utilisation) = Contacts − Sent. */
export function opportunityFigure(contacts: number, sent: number, utilisation: number): Figure {
  const used = pct(utilisation, 0);
  const unused = Math.round(contacts * (1 - Math.min(1, utilisation)));
  return figure(
    `${int(contacts)} contacts, ${used} used`,
    DASHBOARD_FORMULAS.opportunity,
    `${workingDivide(`${int(sent)} sent`, `${int(contacts)} contacts`, `${used} used`)}; ${workingMinus(int(contacts), int(sent), `${int(unused)} not used`)}`,
  );
}

/** A "Review economics" line: cost over sales in bigint micro-euros (truncated). */
export function economicsFigure(costMicro: number, sales: number, cpsMicro: number): Figure {
  const value = eur(cpsMicro);
  return figure(
    `${value} per sale`,
    FORMULAS.costPerSale,
    workingDivide(`${eur(costMicro)} cost`, count(sales, "sale"), value),
    DAY_RULE_NOTE,
  );
}

export function bucketCtrFigure(clicks: number, sent: number): Figure {
  const text = pct(sent > 0 ? clicks / sent : 0);
  return figure(
    text,
    DASHBOARD_FORMULAS.bucketCtr,
    workingDivide(`${int(clicks)} clicked`, `${int(sent)} sent`, text, {
      emptyWhen: sent === 0,
      empty: `No SMS sent to this group, so ${text}`,
    }),
  );
}

export function pctOfGoodFigure(under: number, good: number, threshold: number): Figure {
  const text = pct(good > 0 ? under / good : 0, 0);
  return figure(
    text,
    DASHBOARD_FORMULAS.pctOfGood,
    workingDivide(
      `${int(under)} sent fewer than ${threshold} times`,
      `${int(good)} good contacts`,
      text,
      { emptyWhen: good === 0, empty: `No good contacts, so ${text}` },
    ),
  );
}

export interface AssetRowInput {
  sent: number;
  delivered: number;
  clicks: number;
  sales: number;
  spendMicro: number;
}

/** The computed cells of an Assets row. */
export function assetRowFigures(r: AssetRowInput): {
  delivered: Figure;
  ctr: Figure;
  cpc: Figure;
  costPerSale: Figure;
} {
  const delivered = pct(r.sent > 0 ? r.delivered / r.sent : 0, 1);
  return {
    delivered: figure(
      delivered,
      FORMULAS.deliveryRate,
      workingDivide(`${int(r.delivered)} delivered`, `${int(r.sent)} sent`, delivered, {
        emptyWhen: r.sent === 0,
        empty: `No SMS sent, so ${delivered}`,
      }),
    ),
    ctr: ctrFigure(r.clicks, r.sent),
    cpc: perFigure(FORMULAS.cpc, r.spendMicro, r.clicks, "click", "spend"),
    costPerSale: perFigure(
      FORMULAS.costPerSale,
      r.spendMicro,
      r.sales,
      "sale",
      "spend",
      DAY_RULE_NOTE,
    ),
  };
}
