/**
 * The hover explanations of the campaign screens' computed figures (D5-20): the formula,
 * and the sum with the numbers the screen already shows, so its result is exactly what is
 * on screen (rounding included). Pure, so the wording is tested without a DOM; the
 * components hand the result to `Explained` from @sendex/ui.
 */
import { FORMULAS, workingDivide, workingPerSale, workingSum } from "@sendex/core";
import { formatMicro, formatPer, formatPercent, formatPricePerSms } from "./format";

export interface Explanation {
  formula: string;
  working?: string;
  note?: string;
}

/**
 * Wordings the shared `FORMULAS` do not have, for what these screens compute differently
 * (e.g. a lap's cost counts SMS parts and the custom-route fee).
 */
export const LOCAL_FORMULAS = {
  lapCost:
    "Cost = each SMS sent × its parts × the route's price per part (plus the custom-route fee)",
  campaignCost: "Cost = the laps' costs added up (each SMS sent × its parts × price per part)",
  splitCost: "Cost = each lap's cost shared evenly over the SMS it sent, added up for this row",
  routeCost: "Cost = the costs of this route's laps added up",
  ledgerCost: "Cost = what the ledger charged for these SMS",
  clickRedirects: "Clicks = every redirect a person opened, repeat opens included",
  ctrRedirects: "CTR = Clicks ÷ Sent, where clicks are every redirect (repeat opens count again)",
  rawClicks:
    "All redirects = every time a person opened the link, repeat opens included (link previews left out)",
  conversionSent: "Sent = SMS that left the queue, failed ones included",
  networkSent:
    "Sent = SMS whose status is sent, delivered or expired (a failure report takes one out)",
  progress:
    "Progress = Sent ÷ SMS planned in the laps (before any lap: the contacts available), at most 100%",
  rank: "Rank = the campaign's finished laps by highest CTR, then lowest CPC, then most sent",
  price:
    "Price = the route's price per SMS part for this country today (custom-route fee not included)",
  smsPlanned:
    "SMS = the planned laps added up: each list × route sends the test size (with Send all, the list is split over the routes)",
  parts:
    "Parts: GSM-7 fits 160 characters in one SMS, 153 per part when longer; UCS-2 (any other character) 70, then 67 per part",
  ctrRankPlatform:
    "CTR rank = platform routes for this country by CTR across all accounts, highest first (ties: most sent)",
  cpcRankPlatform:
    "CPC rank = platform routes for this country by cost per click across all accounts, lowest first; no clicks, no rank",
  overallRankPlatform:
    "Overall = highest CTR first, then lowest CPC, then most sent; routes that sent nothing are not ranked",
  daySent: "Sent = SMS sent that day (UTC), all countries added up",
  countries: "Countries = the different countries sent to in this period",
  campaignSends: "Campaign sends = each campaign counted once per day and country it sent to",
  scheduledSms: "SMS = the sizes of the campaign's queued laps added up",
} as const;

/** Above this many terms a working names the count instead of listing every term. */
const MAX_TERMS = 6;

const nf = (n: number) => n.toLocaleString("en-GB");

function count(n: number, one: string, many = `${one}s`): string {
  return `${nf(n)} ${n === 1 ? one : many}`;
}

type RateKind = "ctr" | "deliveryRate" | "leadRate" | "saleRate";

const RATE_NOUN: Record<RateKind, readonly [string, string]> = {
  ctr: ["click", "clicks"],
  deliveryRate: ["delivered", "delivered"],
  leadRate: ["lead", "leads"],
  saleRate: ["sale", "sales"],
};

/** "9 clicks ÷ 190 sent = 4.74%"; `ratio` is the figure on screen, not recomputed. */
export function explainRate(
  kind: RateKind,
  part: number,
  sent: number,
  ratio: number,
  formula: string = FORMULAS[kind],
): Explanation {
  const result = formatPercent(ratio);
  const [one, many] = RATE_NOUN[kind];
  return {
    formula,
    working: workingDivide(count(part, one, many), `${nf(sent)} sent`, result, {
      emptyWhen: sent <= 0,
      empty: `No SMS sent yet, so ${result}`,
    }),
  };
}

type PerKind = "cpc" | "cpl" | "cps";

const PER_NOUN: Record<PerKind, readonly [string, string]> = {
  cpc: ["click", "clicks"],
  cpl: ["lead", "leads"],
  cps: ["sale", "sales"],
};

/** "€1.90 cost ÷ 9 clicks = €0.21", or "No clicks yet, so –". */
export function explainCostPer(
  kind: PerKind,
  costMicro: number,
  n: number,
  perMicro: number | null,
  note?: string,
): Explanation {
  const result = formatPer(perMicro);
  const [one, many] = PER_NOUN[kind];
  return {
    formula: FORMULAS[kind],
    working: workingDivide(`${formatMicro(costMicro)} cost`, count(n, one, many), result, {
      emptyWhen: n <= 0 || perMicro === null,
      empty: `No ${many} yet, so ${result}`,
    }),
    ...(note ? { note } : {}),
  };
}

/** A campaign's cost: its laps' costs added up (the costs, or only how many laps there are). */
export function explainCostOfLaps(
  laps: readonly number[] | number,
  totalMicro: number,
): Explanation {
  const total = formatMicro(totalMicro);
  const lapCount = typeof laps === "number" ? laps : laps.length;
  let working: string;
  if (lapCount === 0) working = workingSum([], total);
  else if (typeof laps === "number" || laps.length > MAX_TERMS)
    working = `${count(lapCount, "lap")} added up = ${total}`;
  else working = workingSum(laps.map(formatMicro), total);
  return { formula: LOCAL_FORMULAS.campaignCost, working };
}

/**
 * A lap's cost: "190 sent × 1 part × €0.0300 = €5.70" when it multiplies out at today's
 * price; otherwise the rule, with today's price in the note (the worker bills each SMS its
 * own parts at the price and fee of the moment).
 */
export function explainLapCost(lap: {
  sent: number;
  parts: number;
  priceMicro: number | null;
  costMicro: number;
}): Explanation {
  const total = formatMicro(lap.costMicro);
  const formula = LOCAL_FORMULAS.lapCost;
  if (lap.sent === 0) return { formula, working: `No SMS sent yet = ${total}` };
  if (lap.priceMicro !== null && lap.sent * lap.parts * lap.priceMicro === lap.costMicro) {
    return {
      formula,
      working: `${nf(lap.sent)} sent × ${count(lap.parts, "part")} × ${formatPricePerSms(lap.priceMicro)} = ${total}`,
    };
  }
  return {
    formula,
    working: `${nf(lap.sent)} sent, each billed its parts × the price when sent = ${total}`,
    ...(lap.priceMicro !== null
      ? {
          note: `Today's price is ${formatPricePerSms(lap.priceMicro)} per part; longer texts, a route fee or a price change make the total differ.`,
        }
      : {}),
  };
}

/** The header's Sending progress, as `campaign-header.tsx` rounds and caps it. */
export function explainProgress(p: {
  sent: number;
  planned: number;
  contacts: number;
  progress: number;
}): Explanation {
  const formula = LOCAL_FORMULAS.progress;
  const target = p.planned > 0 ? p.planned : p.contacts;
  if (target <= 0) {
    return { formula, working: `Nothing planned and no contacts available, so ${p.progress}%` };
  }
  const of = p.planned > 0 ? "planned in the laps" : "contacts available";
  const raw = Math.round((p.sent / target) * 100);
  const shown = raw === p.progress ? `${raw}%` : `${raw}%, shown as ${p.progress}%`;
  return { formula, working: `${nf(p.sent)} sent ÷ ${nf(target)} ${of} = ${shown}` };
}

/** The stored lap rank (`rankLaps`, run each time a lap finishes). */
export function explainRank(rank: number | null, ranked: number): Explanation {
  if (rank === null) {
    return {
      formula: LOCAL_FORMULAS.rank,
      working: "No rank yet: a lap is ranked once it finishes",
    };
  }
  return {
    formula: LOCAL_FORMULAS.rank,
    working: `Rank ${rank} of ${count(ranked, "finished lap")}`,
    note: "Set each time a lap finishes; clicks that come later move it at the next finish.",
  };
}

/** Revenue of first deposits: the total and the average CPA per deposit. */
export function explainRevenue(sales: number, revenueMicro: number): Explanation {
  const perSale = sales > 0 ? formatMicro(Math.round(revenueMicro / sales)) : formatMicro(0);
  return {
    formula: FORMULAS.revenue,
    working: workingPerSale(sales, formatMicro(revenueMicro), perSale),
    ...(sales > 0 && revenueMicro === 0
      ? { note: "A deposit earns nothing when its offer has no brand deal priced for that day." }
      : {}),
  };
}

/** The send bar's SMS: the planned laps' counts added up. */
export function explainSmsPlanned(
  laps: ReadonlyArray<{ count: number }>,
  total: number,
): Explanation {
  const formula = LOCAL_FORMULAS.smsPlanned;
  if (laps.length === 0) return { formula, working: `Nothing planned yet = ${nf(total)}` };
  if (laps.length > MAX_TERMS) {
    return { formula, working: `${count(laps.length, "lap")} added up = ${nf(total)}` };
  }
  return {
    formula,
    working: workingSum(
      laps.map((l) => nf(l.count)),
      nf(total),
    ),
  };
}

/**
 * The send bar's "~€5.50": each planned lap's count × its route price × the parts per SMS
 * (`planLaps`), the price read back from the lap's cost.
 */
export function explainEstimate(
  laps: ReadonlyArray<{ count: number; costMicro: number }>,
  parts: number,
  totalMicro: number,
): Explanation {
  const formula = FORMULAS.estimate;
  const total = `~${formatMicro(totalMicro)}`;
  if (laps.length === 0) return { formula, working: `Nothing planned yet = ${total}` };
  if (laps.length > 4) {
    return {
      formula,
      working: `${count(laps.length, "lap")} of SMS × price × parts added up = ${total}`,
    };
  }
  const terms = laps.map((l) => {
    const price = l.count > 0 && parts > 0 ? l.costMicro / (l.count * parts) : Number.NaN;
    return Number.isInteger(price)
      ? `${nf(l.count)} × ${formatPricePerSms(price)} × ${count(parts, "part")}`
      : null;
  });
  if (terms.every((t): t is string => t !== null)) {
    return { formula, working: `${terms.join(" + ")} = ${total}` };
  }
  return {
    formula,
    working: workingSum(
      laps.map((l) => formatMicro(l.costMicro)),
      total,
    ),
  };
}

const SINGLE: Record<string, number> = { GSM_7BIT: 160, UCS2: 70 };
const MULTI: Record<string, number> = { GSM_7BIT: 153, UCS2: 67 };

/**
 * The ad-text counter: why the text takes that many parts and how many characters are left.
 * With `linkLength`, the note says how `analyseAdText` counted the link and word choices.
 */
export function explainParts(
  a: { encoding: string; chars: number; parts: number; left: number },
  linkLength?: number,
): Explanation {
  const formula = LOCAL_FORMULAS.parts;
  const note =
    linkLength === undefined
      ? {}
      : {
          note: `{{domain}} counts as the ${linkLength}-character short link; {a|b} as its longest word.`,
        };
  const single = SINGLE[a.encoding] ?? 70;
  const multi = MULTI[a.encoding] ?? 67;
  if (a.parts <= 1) {
    return {
      formula,
      working: `${nf(a.chars)} chars ≤ ${single}, so 1 part; ${single} − ${nf(a.chars)} = ${nf(a.left)} left`,
      ...note,
    };
  }
  return {
    formula,
    working: `${nf(a.chars)} chars ÷ ${multi} per part, rounded up = ${a.parts} parts; ${a.parts} × ${multi} − ${nf(a.chars)} = ${nf(a.left)} left`,
    ...note,
  };
}

/** A calendar day's total and its bar, scaled to the busiest day in view. */
export function explainDaySent(
  countrySent: readonly number[],
  total: number,
  busiest: number,
  barPercent: number,
): Explanation {
  const working =
    countrySent.length > MAX_TERMS
      ? `${count(countrySent.length, "country", "countries")} added up = ${nf(total)}`
      : workingSum(countrySent.map(nf), nf(total));
  const share = busiest > 0 ? Math.round((total / busiest) * 100) : 0;
  const drawn = share === barPercent ? "" : `, drawn at least ${barPercent}% wide`;
  return {
    formula: LOCAL_FORMULAS.daySent,
    working,
    note: `Bar: ${nf(total)} ÷ ${nf(busiest)} on the busiest day = ${share}%${drawn}`,
  };
}

/** The calendar's Countries tile: the names counted. */
export function explainCountries(names: readonly string[], total: number): Explanation {
  const formula = LOCAL_FORMULAS.countries;
  if (names.length === 0) return { formula, working: `No sends in this period = ${nf(total)}` };
  const shown =
    names.length > 5
      ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more`
      : names.join(", ");
  return { formula, working: `${shown} = ${nf(total)}` };
}
