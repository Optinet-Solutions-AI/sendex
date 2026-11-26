import { FORMULAS, formatEur, workingDivide, workingMinus, workingPerSale } from "@sendex/core";

/**
 * Hover explanations for the computed figures of the Reports, Lists, Routes, Billing and
 * Brand deals screens (D5-20). Each function takes the numbers a row already has and the
 * value exactly as the screen shows it, so the working always ends on what is on screen,
 * rounding included. Wordings shared by every screen live in `FORMULAS` (@sendex/core);
 * the ones only these screens need are here.
 */

export interface Explanation {
  formula: string;
  working?: string;
  note?: string;
}

export const LOCAL_FORMULAS = {
  // Campaigns Log
  logSpend: "Spend = what the ledger charged for these SMS (debits and fees, less refunds)",
  leadsSales: "Leads = sign-ups; Sales = first deposits (one per SMS)",
  lateSales: "Late sales = first deposits made on a later UTC day than their SMS",
  // Postback Logs
  timing: "Timing = UTC day received − UTC day the SMS was sent (0 days = Same day)",
  dealRevenue:
    "Revenue (deal) = the CPA of the offer's brand deal on the deposit day, earned by a first deposit only",
  trackerAmount:
    "Tracker amount = the amount your tracker sent with the postback; it is not revenue",
  // Brand deals
  cpaCounted: "CPA counted = the euro CPA read from the deal text (revshare and base left out)",
  // Lists
  listCtr: "CTR = Clicks ÷ Sent, over every lap any campaign sent to this list",
  lapSpend: "Spend = cost of every lap sent to this list (SMS parts × (price + route fee))",
  lapCost: "Cost = cost of the campaign's laps on this list (SMS parts × (price + route fee))",
  ledgerCost: "Cost = what the ledger charged for these SMS (debits and fees, less refunds)",
  analyticsSales: "Sales = SMS with at least one sale postback",
  analyticsRevenue: "Revenue = the deal CPA each first deposit earned, added up",
  good: "Good = Total − Bad",
  unresolved: "Unresolved = Total − Bad − HLR − MNP − Local only − Checking",
  lookupCtr:
    "CTR = Clicks ÷ Sent (Sent = members sent to since the last flush; Clicks = SMS clicked, all time, link previews included)",
  progress: "Progress = valid rows ÷ rows in the file",
  // Routes
  routeCost: "Total cost = debits + route fees charged for these SMS",
  ctrDelta: "Δ = operator CTR − country CTR, in percentage points",
  share: "Share of Country = operator Sent ÷ country Sent",
  networkSales: "Sales = sale postbacks on these SMS (repeat deposits included)",
  successRate: "Success rate = SMS the carrier accepted ÷ tests ran",
  testCost: "Cost = SMS parts × (price + route fee), for each test SMS the carrier accepted",
  testMonthCost: "Cost = the cost of the tests created that month (UTC)",
  testEstimate:
    "Estimate = combinations × each chosen route's price (Cascade: combinations × the dearest route's price)",
  testEstimateNote:
    "One SMS part per message and no route fee; a route without a price counts as €0. The charge is parts × (price + fee) of the route that accepts.",
  // Billing
  ledgerBalance:
    "Balance = sum of every ledger entry (deposits − spend + refunds ± adjustments); no carrier reports a balance",
  deposits: "Deposits = money added to the account that day",
  debits: "Debits = SMS charges + custom route fees that day",
  refunds: "Refunds = charges given back that day (e.g. SMS that failed)",
  adjustments: "Adjustments = manual corrections that day (either sign)",
  net: "Net = Deposits + Debits + Refunds + Adjustments (every ledger entry of the day)",
  entries: "Entries = ledger entries that day",
  total: "Total = the days above added up",
  campaignMessages: "Messages = SMS of the campaign with a charge or refund in this range",
  campaignDebits: "Debits = SMS charges + custom route fees of the campaign's SMS",
  campaignRefunds: "Refunds = charges given back on the campaign's SMS",
  campaignSpend: "Spend = Debits − Refunds on the campaign's SMS in this range",
} as const;

const integer = new Intl.NumberFormat("en-GB");

/** Same grouping as `formatNumber` and the dashboard's `int`. */
function n(value: number): string {
  return integer.format(value);
}

function plural(value: number, one: string, many = `${one}s`): string {
  return `${n(value)} ${value === 1 ? one : many}`;
}

/** "9 clicks ÷ 190 sent = 4.74%"; "No SMS sent yet, so 0.00%". */
export function explainCtr(
  clicks: number,
  sent: number,
  shown: string,
  formula: string = FORMULAS.ctr,
): Explanation {
  return {
    formula,
    working: workingDivide(plural(clicks, "click"), `${n(sent)} sent`, shown, {
      emptyWhen: sent === 0,
      empty: `No SMS sent yet, so ${shown}`,
    }),
  };
}

export const CPC_CUT_NOTE =
  "Worked out on the exact spend (the cents shown are rounded) and cut, not rounded, to four decimals.";

/** "€12.35 spend ÷ 9 clicks = €1.3722"; the Campaigns Log works it on the exact spend, cut to four decimals. */
export function explainCpc(
  spendShown: string,
  clicks: number,
  shown: string,
  options: { costWord?: string; note?: string } = {},
): Explanation {
  return {
    formula: FORMULAS.cpc,
    working: workingDivide(
      `${spendShown} ${options.costWord ?? "spend"}`,
      plural(clicks, "click"),
      shown,
      {
        emptyWhen: clicks === 0,
        empty: "No clicks yet, so no CPC",
      },
    ),
    note: options.note ?? CPC_CUT_NOTE,
  };
}

export function explainDelivery(delivered: number, sent: number, shown: string): Explanation {
  return {
    formula: FORMULAS.deliveryRate,
    working: workingDivide(`${n(delivered)} delivered`, `${n(sent)} sent`, shown, {
      emptyWhen: sent === 0,
      empty: `No SMS sent yet, so ${shown}`,
    }),
  };
}

export function explainSuccess(accepted: number, ran: number, shown: string): Explanation {
  return {
    formula: LOCAL_FORMULAS.successRate,
    working: workingDivide(`${n(accepted)} accepted`, `${plural(ran, "test")} ran`, shown, {
      emptyWhen: ran === 0,
      empty: "No tests ran yet, so no success rate",
    }),
  };
}

export function explainShare(
  operatorSent: number,
  countrySent: number,
  shown: string,
): Explanation {
  return {
    formula: LOCAL_FORMULAS.share,
    working: workingDivide(
      `${n(operatorSent)} operator sent`,
      `${n(countrySent)} country sent`,
      shown,
      {
        emptyWhen: countrySent === 0,
        empty: `Nothing sent in the country, so ${shown}`,
      },
    ),
  };
}

export function explainProgress(valid: number, rows: number, shown: string): Explanation {
  return {
    formula: LOCAL_FORMULAS.progress,
    working: workingDivide(`${n(valid)} valid rows`, `${n(rows)} rows in the file`, shown, {
      emptyWhen: rows === 0,
      empty: `The file had no rows, so ${shown}`,
    }),
  };
}

/** "4.10% operator − 3.20% country = +0.9 pts". */
export function explainCtrDelta(
  operatorShown: string,
  countryShown: string,
  shown: string,
): Explanation {
  return {
    formula: LOCAL_FORMULAS.ctrDelta,
    working: `${workingMinus(`${operatorShown} operator`, `${countryShown} country`, shown)} pts`,
  };
}

/** "5 same day + 2 late = 7 sales". */
export function explainLateSplit(sales: number, late: number): string {
  if (sales === 0) return "No first deposits in this period";
  return `${n(sales - late)} same day + ${n(late)} late = ${plural(sales, "sale")}`;
}

/** Whole UTC days between the SMS and the conversion, as the Timing badge counts them. */
export function explainTiming(
  timing: "same_day" | "late" | null,
  daysLater: number | null,
  messageSentAt: string | null,
  receivedAt: string,
): Explanation {
  if (timing === null || messageSentAt === null) {
    return {
      formula: LOCAL_FORMULAS.timing,
      working: "No SMS carried this dynamic id, so there is no timing",
    };
  }
  const days = daysLater ?? 0;
  const label = timing === "same_day" ? "Same day" : `Late · ${plural(days, "day")}`;
  return {
    formula: LOCAL_FORMULAS.timing,
    working: `Received ${receivedAt.slice(0, 10)} − SMS sent ${messageSentAt.slice(0, 10)} = ${plural(days, "day")}, so ${label}`,
  };
}

/** The deal CPA a first deposit earned, or why the postback earned nothing. */
export function explainDealRevenue(input: {
  type: "lead" | "sale";
  attributed: boolean;
  shown: string | null;
}): Explanation {
  const formula = LOCAL_FORMULAS.dealRevenue;
  if (input.type === "lead") {
    return { formula, working: "A lead earns nothing; only first deposits earn revenue" };
  }
  if (!input.attributed) return { formula, working: "Matched no SMS, so it earns nothing" };
  if (input.shown === null) {
    return {
      formula,
      working:
        "Nothing earned: a repeat deposit on the same SMS, an offer without a brand deal, or a deal without a euro CPA that day",
    };
  }
  return { formula, working: workingPerSale(1, input.shown, input.shown) };
}

export function explainTrackerAmount(shown: string | null): Explanation {
  return {
    formula: LOCAL_FORMULAS.trackerAmount,
    working:
      shown === null
        ? "The tracker sent no amount"
        : `The tracker sent ${shown}; Sendex does not count it as revenue`,
  };
}

/** "“€200 CPA + 40% rev” → €200.00 per first deposit", or the reason there is no price. */
export function explainCpaCounted(
  deal: string,
  shown: string | null,
  reason: string | null,
): Explanation {
  const quoted = deal.trim() === "" ? "No deal text" : `“${deal.trim()}”`;
  if (shown === null) {
    return {
      formula: LOCAL_FORMULAS.cpaCounted,
      working: `${quoted}: ${reason ?? "No price"}, so its first deposits earn nothing`,
    };
  }
  return { formula: LOCAL_FORMULAS.cpaCounted, working: `${quoted} → ${shown} per first deposit` };
}

export function explainGood(total: number, bad: number): Explanation {
  return {
    formula: LOCAL_FORMULAS.good,
    working: workingMinus(`${n(total)} total`, `${n(bad)} bad`, n(total - bad)),
  };
}

export function explainUnresolved(row: {
  total: number;
  bad: number;
  hlr: number;
  mnp: number;
  localOnly: number;
  checking: number;
}): Explanation {
  const result = row.total - row.bad - row.hlr - row.mnp - row.localOnly - row.checking;
  return {
    formula: LOCAL_FORMULAS.unresolved,
    working: `${n(row.total)} total − ${n(row.bad)} bad − ${n(row.hlr)} HLR − ${n(row.mnp)} MNP − ${n(row.localOnly)} local only − ${n(row.checking)} checking = ${n(result)}`,
  };
}

/** Signed parts as the Billing table shows them: "€100.00 deposits − €12.34 debits". */
function signedSum(parts: ReadonlyArray<[bigint, string]>): string {
  let out = "";
  for (const [micro, label] of parts) {
    if (micro === 0n) continue;
    if (out === "") out = `${formatEur(micro)} ${label}`;
    else out += ` ${micro < 0n ? "−" : "+"} ${formatEur(micro < 0n ? -micro : micro)} ${label}`;
  }
  return out;
}

/** Rounded parts can miss the rounded result by a cent; say so when they do. */
function roundingNote(parts: readonly bigint[], resultMicro: bigint): string | undefined {
  const cents = (micro: bigint) => {
    const abs = micro < 0n ? -micro : micro;
    const c = (abs + 5_000n) / 10_000n;
    return micro < 0n ? -c : c;
  };
  const sum = parts.reduce((t, p) => t + cents(p), 0n);
  return sum === cents(resultMicro)
    ? undefined
    : "Each part is rounded to the cent; the result is worked out on the exact amounts.";
}

export function explainNet(row: {
  depositsMicro: bigint;
  debitsMicro: bigint;
  refundsMicro: bigint;
  adjustmentsMicro: bigint;
  netMicro: bigint;
}): Explanation {
  const parts: Array<[bigint, string]> = [
    [row.depositsMicro, "deposits"],
    [row.debitsMicro, "debits"],
    [row.refundsMicro, "refunds"],
    [row.adjustmentsMicro, "adjustments"],
  ];
  const sum = signedSum(parts);
  const shown = formatEur(row.netMicro);
  const note = roundingNote(
    parts.map(([m]) => m),
    row.netMicro,
  );
  return {
    formula: LOCAL_FORMULAS.net,
    working: sum === "" ? `Nothing yet = ${shown}` : `${sum} = ${shown}`,
    ...(note ? { note } : {}),
  };
}

/** Spend by campaign: −(debits + refunds + anything else on the campaign's SMS). */
export function explainCampaignSpend(row: {
  debitsMicro: bigint;
  refundsMicro: bigint;
  netMicro: bigint;
}): Explanation {
  const other = row.netMicro - row.debitsMicro - row.refundsMicro;
  // Spend is the net with its sign turned, so each part turns too.
  const parts: Array<[bigint, string]> = [
    [-row.debitsMicro, "debits"],
    [-row.refundsMicro, "refunds"],
    [-other, "other entries"],
  ];
  const sum = signedSum(parts);
  const shown = formatEur(-row.netMicro);
  const note = roundingNote(
    parts.map(([m]) => m),
    -row.netMicro,
  );
  return {
    formula: LOCAL_FORMULAS.campaignSpend,
    working: sum === "" ? `Nothing yet = ${shown}` : `${sum} = ${shown}`,
    ...(note ? { note } : {}),
  };
}

export function explainBalance(input: {
  source: "carrier" | "ledger";
  carriers: ReadonlyArray<{ label: string; shown: string }>;
  shown: string;
}): Explanation {
  if (input.source === "ledger") {
    return {
      formula: LOCAL_FORMULAS.ledgerBalance,
      working: `Sum of every ledger entry = ${input.shown}`,
    };
  }
  return {
    formula: FORMULAS.balance,
    working: `${input.carriers.map((c) => `${c.label} ${c.shown}`).join(" + ")} = ${input.shown}`,
  };
}

function price4(micro: number | null): string {
  if (micro === null) return "€0.0000 no price";
  return `€${(micro / 1_000_000).toFixed(4)}`;
}

/** The Send Single / Test SMS cost estimate, as `testCostEstimate` works it out. */
export function explainEstimate(input: {
  combos: number;
  priceMicros: ReadonlyArray<number | null>;
  cascade: boolean;
  tests: number;
  shown: string;
}): Explanation {
  const base = { formula: LOCAL_FORMULAS.testEstimate, note: LOCAL_FORMULAS.testEstimateNote };
  if (input.tests === 0) {
    return { ...base, working: "No route, sender or text chosen yet, so no estimate" };
  }
  const combos = plural(input.combos, "combination");
  if (input.cascade) {
    const dearest = input.priceMicros.reduce<number>((m, p) => Math.max(m, p ?? 0), 0);
    return { ...base, working: `${combos} × ${price4(dearest)} dearest route = ${input.shown}` };
  }
  const prices = input.priceMicros.map(price4);
  const each = prices.length === 1 ? (prices[0] ?? "") : `(${prices.join(" + ")})`;
  return { ...base, working: `${combos} × ${each} = ${input.shown}` };
}

/** A Total row: the rows above added up, or a count of them when there are many. */
export function explainTotal(parts: readonly string[], shown: string, noun: string): string {
  if (parts.length === 0) return `Nothing yet = ${shown}`;
  if (parts.length > 6) return `${n(parts.length)} ${noun} added up = ${shown}`;
  return `${parts.join(" + ")} = ${shown}`;
}
