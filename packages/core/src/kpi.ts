import { z } from "zod";

/**
 * Pure maths of the KPI screens (D5-03 onwards), built from the Business KPIs Manager
 * walkthrough of 11 November 2026. The vocabulary is Sendex's own: an offer is that tool's
 * "brand", a route its "source", a lead its "SU" (sign-up) and a sale its "FTD".
 *
 * Sends, leads and cost belong to the day the SMS went out; sales and revenue to the day the
 * deposit was made (D4-17). The database helpers do that windowing; these functions only add
 * up and divide.
 */

export interface KpiCounters {
  /** SMS submitted to a carrier. */
  sent: number;
  /** Registrations reported by the tracker. */
  leads: number;
  /** First deposits (one per message). */
  sales: number;
  /** Micro-EUR spent on the sends. */
  costMicro: bigint;
  /** Micro-EUR the sales paid. */
  revenueMicro: bigint;
}

export const ZERO_COUNTERS: KpiCounters = {
  sent: 0,
  leads: 0,
  sales: 0,
  costMicro: 0n,
  revenueMicro: 0n,
};

export function addCounters(a: KpiCounters, b: KpiCounters): KpiCounters {
  return {
    sent: a.sent + b.sent,
    leads: a.leads + b.leads,
    sales: a.sales + b.sales,
    costMicro: a.costMicro + b.costMicro,
    revenueMicro: a.revenueMicro + b.revenueMicro,
  };
}

/** Sales per lead as a fraction (0.15 is 15 %); null without leads. */
export function leadToSale(c: Pick<KpiCounters, "leads" | "sales">): number | null {
  return c.leads > 0 ? c.sales / c.leads : null;
}

export function profitMicro(c: Pick<KpiCounters, "costMicro" | "revenueMicro">): bigint {
  return c.revenueMicro - c.costMicro;
}

/**
 * Profit over cost as a fraction (1.5 is 150 %), the dashboard's definition of ROI; null
 * without cost. The tool in the recording shows revenue over cost under the same name, which
 * reads 100 points higher; Sendex keeps one definition everywhere.
 */
export function roi(c: Pick<KpiCounters, "costMicro" | "revenueMicro">): number | null {
  return c.costMicro > 0n ? Number(profitMicro(c)) / Number(c.costMicro) : null;
}

/** How many SMS it took to get one sale ("contacts per FTD"), rounded; null without sales. */
export function smsPerSale(c: Pick<KpiCounters, "sent" | "sales">): number | null {
  return c.sales > 0 ? Math.round(c.sent / c.sales) : null;
}

function perSale(micro: bigint, sales: number): bigint | null {
  return sales > 0 ? micro / BigInt(sales) : null;
}

export function costPerSaleMicro(c: Pick<KpiCounters, "costMicro" | "sales">): bigint | null {
  return perSale(c.costMicro, c.sales);
}

export function revenuePerSaleMicro(c: Pick<KpiCounters, "revenueMicro" | "sales">): bigint | null {
  return perSale(c.revenueMicro, c.sales);
}

export function profitPerSaleMicro(
  c: Pick<KpiCounters, "costMicro" | "revenueMicro" | "sales">,
): bigint | null {
  return perSale(profitMicro(c), c.sales);
}

/** Best first by a nullable number; nulls last. */
function byDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

// ---------------------------------------------------------------------------
// List Follow-Up (D5-03)
// ---------------------------------------------------------------------------

export interface ListFollowUpRow extends KpiCounters {
  listId: string;
  name: string;
  country: string;
  /** Who supplied the data (D5-01); null when not set. */
  provider: string | null;
  numbersCount: number;
  /** The last send inside the filters; null when the list was not sent in them. */
  lastSentAt: Date | null;
  createdAt: Date;
}

export interface CountryFollowUp extends KpiCounters {
  country: string;
  /** Lists of the country that were sent inside the filters. */
  totalLists: number;
  lastSentAt: Date | null;
  lists: ListFollowUpRow[];
}

export interface ListFollowUp {
  /** Countries with at least one sent list, best ROI first. */
  countries: CountryFollowUp[];
  /** Lists with no send inside the filters ("never sent"), by country then name. */
  untouched: ListFollowUpRow[];
}

/**
 * The List Follow-Up table: lists that were sent, grouped by country with the country's
 * totals, and the lists that were not touched. A list counts as sent when it has at least one
 * SMS or one sale inside the filters.
 */
export function groupListFollowUp(rows: readonly ListFollowUpRow[]): ListFollowUp {
  const used = rows.filter((r) => r.sent > 0 || r.sales > 0);
  const untouched = rows
    .filter((r) => r.sent === 0 && r.sales === 0)
    .sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

  const byCountry = new Map<string, ListFollowUpRow[]>();
  for (const row of used) {
    const lists = byCountry.get(row.country) ?? [];
    lists.push(row);
    byCountry.set(row.country, lists);
  }
  const countries: CountryFollowUp[] = [...byCountry.entries()].map(([country, lists]) => {
    const totals = lists.reduce<KpiCounters>((sum, l) => addCounters(sum, l), ZERO_COUNTERS);
    const lastSentAt = lists.reduce<Date | null>(
      (latest, l) =>
        l.lastSentAt && (latest === null || l.lastSentAt > latest) ? l.lastSentAt : latest,
      null,
    );
    return {
      ...totals,
      country,
      totalLists: lists.length,
      lastSentAt,
      lists: [...lists].sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name)),
    };
  });
  countries.sort((a, b) => byDesc(roi(a), roi(b)) || a.country.localeCompare(b.country));
  return { countries, untouched };
}

// ---------------------------------------------------------------------------
// Performance Insight (D5-04)
// ---------------------------------------------------------------------------

/** One offer in one country: the grain every Insight figure is built from. */
export interface OfferCountryRow extends KpiCounters {
  country: string;
  /** Null for messages that carried no tracked link. */
  offerId: string | null;
  offer: string;
}

export interface InsightTotals extends KpiCounters {
  profitMicro: bigint;
  costPerSaleMicro: bigint | null;
  revenuePerSaleMicro: bigint | null;
  profitPerSaleMicro: bigint | null;
  smsPerSale: number | null;
}

function sum(rows: readonly KpiCounters[]): KpiCounters {
  return rows.reduce<KpiCounters>((total, r) => addCounters(total, r), ZERO_COUNTERS);
}

/** The eight tiles: sales, revenue, cost, profit and the four per-sale figures. */
export function insightTotals(rows: readonly KpiCounters[]): InsightTotals {
  const totals = sum(rows);
  return {
    ...totals,
    profitMicro: profitMicro(totals),
    costPerSaleMicro: costPerSaleMicro(totals),
    revenuePerSaleMicro: revenuePerSaleMicro(totals),
    profitPerSaleMicro: profitPerSaleMicro(totals),
    smsPerSale: smsPerSale(totals),
  };
}

export interface RollUpRow extends KpiCounters {
  /** The offer name or the country code. */
  label: string;
}

/** Totals per offer or per country, most sales first, then most revenue, then by name. */
export function rollUp(rows: readonly OfferCountryRow[], by: "offer" | "country"): RollUpRow[] {
  const groups = new Map<string, KpiCounters>();
  for (const row of rows) {
    const label = by === "offer" ? row.offer : row.country;
    groups.set(label, addCounters(groups.get(label) ?? ZERO_COUNTERS, row));
  }
  return [...groups.entries()]
    .map(([label, counters]) => ({ ...counters, label }))
    .sort(
      (a, b) =>
        b.sales - a.sales ||
        Number(b.revenueMicro - a.revenueMicro) ||
        a.label.localeCompare(b.label),
    );
}

export interface CountryOffers {
  country: string;
  /** Sales of the whole country, not only of the offers shown. */
  sales: number;
  offers: OfferCountryRow[];
}

/**
 * "Offer performance by country": for each country, its best offers by ROI or by sales.
 * Countries come most sales first. An offer without cost has no ROI and goes last.
 */
export function topOffersByCountry(
  rows: readonly OfferCountryRow[],
  sort: "roi" | "sales",
  top = 5,
): CountryOffers[] {
  const byCountry = new Map<string, OfferCountryRow[]>();
  for (const row of rows) {
    const list = byCountry.get(row.country) ?? [];
    list.push(row);
    byCountry.set(row.country, list);
  }
  return [...byCountry.entries()]
    .map(([country, offers]) => ({
      country,
      sales: offers.reduce((n, o) => n + o.sales, 0),
      offers: [...offers]
        .sort((a, b) =>
          sort === "roi"
            ? byDesc(roi(a), roi(b)) || b.sales - a.sales || a.offer.localeCompare(b.offer)
            : b.sales - a.sales || byDesc(roi(a), roi(b)) || a.offer.localeCompare(b.offer),
        )
        .slice(0, top),
    }))
    .sort((a, b) => b.sales - a.sales || a.country.localeCompare(b.country));
}

export interface EfficiencyRow {
  offer: string;
  smsPerSale: number;
  sales: number;
}

/** "SMS per sale": the offers that need the fewest SMS to get one sale, best first. */
export function efficiencySnapshot(rows: readonly OfferCountryRow[], top = 6): EfficiencyRow[] {
  return rollUp(rows, "offer")
    .flatMap((o) => {
      const perSale = smsPerSale(o);
      return perSale === null ? [] : [{ offer: o.label, smsPerSale: perSale, sales: o.sales }];
    })
    .sort((a, b) => a.smsPerSale - b.smsPerSale || a.offer.localeCompare(b.offer))
    .slice(0, top);
}

// ---------------------------------------------------------------------------
// Sales Results (D5-05)
// ---------------------------------------------------------------------------

/**
 * One line of the Sales Results table: a day, an offer, a route, a country, a list and its
 * data provider, with the registrations of the SMS sent that day and the first deposits made
 * that day.
 */
export interface SalesResultRow {
  /** YYYY-MM-DD, UTC. */
  day: string;
  offer: string;
  routeName: string;
  country: string;
  listName: string | null;
  provider: string | null;
  leads: number;
  sales: number;
  revenueMicro: bigint;
}

export type SalesResultSort = "day" | "leads" | "sales" | "revenue";

/** Sort the table by a column, largest (or latest) first, most sales breaking ties. */
export function sortSalesResults<
  T extends Pick<SalesResultRow, "day" | "leads" | "sales"> & {
    revenueMicro: bigint | string;
  },
>(rows: readonly T[], by: SalesResultSort): T[] {
  const revenue = (r: T) => Number(BigInt(r.revenueMicro));
  const value = (r: T): number | string =>
    by === "day" ? r.day : by === "leads" ? r.leads : by === "sales" ? r.sales : revenue(r);
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const main = typeof x === "string" ? String(y).localeCompare(x) : Number(y) - x;
    return main || b.sales - a.sales || b.day.localeCompare(a.day);
  });
}

// ---------------------------------------------------------------------------
// Trends (D5-06)
// ---------------------------------------------------------------------------

export const TREND_DIMENSIONS = ["route", "offer", "country", "provider"] as const;
export type TrendDimension = (typeof TREND_DIMENSIONS)[number];

/** Leads of the SMS sent on a day and sales made on that day, for one group (a route, …). */
export interface DailyRow {
  /** YYYY-MM-DD, UTC. */
  day: string;
  key: string;
  leads: number;
  sales: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const dayOf = (row: DailyRow): number => Number(row.day.slice(8, 10));

/**
 * The last day of the month there are figures for: today for the month in progress, the
 * month's last day for a past month, 0 for a month that has not started.
 */
export function throughDay(year: number, month: number, now: Date): number {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const asked = year * 12 + (month - 1);
  if (asked > current) return 0;
  if (asked < current) return daysInMonth(year, month);
  return now.getUTCDate();
}

function totalsThrough(rows: readonly DailyRow[], through: number) {
  let leads = 0;
  let sales = 0;
  for (const row of rows) {
    if (dayOf(row) > through) continue;
    leads += row.leads;
    sales += row.sales;
  }
  return { leads, sales, conversion: leads > 0 ? sales / leads : null };
}

export interface TrendSummary {
  leads: number;
  sales: number;
  /** Sales per lead, 0..1. */
  conversion: number | null;
  /** Change against the same days of the month before, as a fraction; null without a base. */
  leadsChange: number | null;
  salesChange: number | null;
  /** Change of the conversion in percentage points. */
  conversionChangePoints: number | null;
}

/** The three tiles: the month through `through`, against the same days of the month before. */
export function trendSummary(
  rows: readonly DailyRow[],
  previous: readonly DailyRow[],
  through: number,
): TrendSummary {
  const now = totalsThrough(rows, through);
  const before = totalsThrough(previous, through);
  const change = (a: number, b: number) => (b > 0 ? (a - b) / b : null);
  return {
    ...now,
    leadsChange: change(now.leads, before.leads),
    salesChange: change(now.sales, before.sales),
    conversionChangePoints:
      now.conversion !== null && before.conversion !== null
        ? (now.conversion - before.conversion) * 100
        : null,
  };
}

export interface TrendPoint {
  /** Day of the month, 1-based. */
  day: number;
  /** Null after the last day there are figures for. */
  leads: number | null;
  sales: number | null;
  prevLeads: number;
  prevSales: number;
}

/**
 * One point per day of the month: leads and sales of the day, or running totals, next to the
 * same day of the month before (which is complete, so it runs to the end).
 */
export function trendSeries(
  rows: readonly DailyRow[],
  previous: readonly DailyRow[],
  options: { year: number; month: number; through: number; cumulative?: boolean },
): TrendPoint[] {
  const days = daysInMonth(options.year, options.month);
  const perDay = (source: readonly DailyRow[]) => {
    const leads = new Array<number>(days + 1).fill(0);
    const sales = new Array<number>(days + 1).fill(0);
    for (const row of source) {
      const day = dayOf(row);
      if (day < 1 || day > days) continue;
      leads[day] = (leads[day] ?? 0) + row.leads;
      sales[day] = (sales[day] ?? 0) + row.sales;
    }
    return { leads, sales };
  };
  const now = perDay(rows);
  const before = perDay(previous);
  const points: TrendPoint[] = [];
  const running = { leads: 0, sales: 0, prevLeads: 0, prevSales: 0 };
  for (let day = 1; day <= days; day += 1) {
    running.leads += now.leads[day] ?? 0;
    running.sales += now.sales[day] ?? 0;
    running.prevLeads += before.leads[day] ?? 0;
    running.prevSales += before.sales[day] ?? 0;
    const known = day <= options.through;
    points.push(
      options.cumulative
        ? {
            day,
            leads: known ? running.leads : null,
            sales: known ? running.sales : null,
            prevLeads: running.prevLeads,
            prevSales: running.prevSales,
          }
        : {
            day,
            leads: known ? (now.leads[day] ?? 0) : null,
            sales: known ? (now.sales[day] ?? 0) : null,
            prevLeads: before.leads[day] ?? 0,
            prevSales: before.sales[day] ?? 0,
          },
    );
  }
  return points;
}

export interface TrendBreakdownRow {
  key: string;
  leads: number;
  sales: number;
  conversion: number | null;
  /** Conversion of days 1 to 15; null without leads in them. */
  firstHalf: number | null;
  /** Conversion of day 16 to the end; null without leads in them. */
  secondHalf: number | null;
  /** How the second half compares with the first; null when a half has no leads. */
  trend: "up" | "down" | "flat" | null;
}

/** The breakdown table: each group's month, its two halves and the direction between them. */
export function trendBreakdown(rows: readonly DailyRow[]): TrendBreakdownRow[] {
  const groups = new Map<string, { first: [number, number]; second: [number, number] }>();
  for (const row of rows) {
    const group = groups.get(row.key) ?? { first: [0, 0], second: [0, 0] };
    const half = dayOf(row) <= 15 ? group.first : group.second;
    half[0] += row.leads;
    half[1] += row.sales;
    groups.set(row.key, group);
  }
  const rate = (leads: number, sales: number) => (leads > 0 ? sales / leads : null);
  return [...groups.entries()]
    .map(([key, g]) => {
      const leads = g.first[0] + g.second[0];
      const sales = g.first[1] + g.second[1];
      const firstHalf = rate(g.first[0], g.first[1]);
      const secondHalf = rate(g.second[0], g.second[1]);
      const trend: TrendBreakdownRow["trend"] =
        firstHalf === null || secondHalf === null
          ? null
          : secondHalf > firstHalf
            ? "up"
            : secondHalf < firstHalf
              ? "down"
              : "flat";
      return { key, leads, sales, conversion: rate(leads, sales), firstHalf, secondHalf, trend };
    })
    .sort((a, b) => b.leads - a.leads || b.sales - a.sales || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Campaign creator (D5-07)
// ---------------------------------------------------------------------------

export const CREATOR_PERIODS = [
  "this_month",
  "last_month",
  "last_3_months",
  "last_6_months",
  "last_12_months",
] as const;
export type CreatorPeriod = (typeof CREATOR_PERIODS)[number];

export const CREATOR_PERIOD_LABELS: Record<CreatorPeriod, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
  last_12_months: "Last 12 months",
};

const CREATOR_MONTHS: Record<Exclude<CreatorPeriod, "this_month">, number> = {
  last_month: 1,
  last_3_months: 3,
  last_6_months: 6,
  last_12_months: 12,
};

function dayLabel(date: Date): string {
  const text = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  // Node writes "Sept" for September in en-GB; keep the three-letter form used elsewhere.
  return text.replace("Sept", "Sep");
}

/**
 * The window the creator ranks on, end exclusive, and how to say it: this month up to today,
 * or the last 1, 3, 6 or 12 whole months before this one.
 */
export function creatorPeriod(
  period: CreatorPeriod,
  now: Date,
): { from: Date; to: Date; label: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const window =
    period === "this_month"
      ? {
          from: new Date(Date.UTC(year, month, 1)),
          to: new Date(Date.UTC(year, month, now.getUTCDate() + 1)),
        }
      : {
          from: new Date(Date.UTC(year, month - CREATOR_MONTHS[period], 1)),
          to: new Date(Date.UTC(year, month, 1)),
        };
  const lastDay = new Date(window.to.getTime() - 86_400_000);
  return { ...window, label: `${dayLabel(window.from)} – ${dayLabel(lastDay)}` };
}

export interface CreatorOffer {
  id: string;
  name: string;
}

export interface RankedOffer {
  offerId: string;
  offer: string;
  roi: number | null;
  leadToSale: number | null;
  sales: number;
  /** True when the offer was never sent to this country, in any period. */
  neverSent: boolean;
}

/**
 * "Top offers for a country": the offers sent there in the period, best ROI first, then the
 * offers sent there before the period (no figures), then the ones never sent there.
 */
export function rankOffersForCountry(
  period: readonly OfferCountryRow[],
  ever: readonly OfferCountryRow[],
  offers: readonly CreatorOffer[],
  country: string,
): RankedOffer[] {
  const inPeriod = new Map<string, OfferCountryRow>();
  for (const row of period) {
    if (row.country === country && row.offerId) inPeriod.set(row.offerId, row);
  }
  const sentEver = new Set(
    ever.filter((r) => r.country === country && r.sent > 0).flatMap((r) => r.offerId ?? []),
  );
  const rank = (o: RankedOffer) => (inPeriod.has(o.offerId) ? 0 : o.neverSent ? 2 : 1);
  return offers
    .map((offer) => {
      const row = inPeriod.get(offer.id);
      return {
        offerId: offer.id,
        offer: offer.name,
        roi: row ? roi(row) : null,
        leadToSale: row ? leadToSale(row) : null,
        sales: row?.sales ?? 0,
        neverSent: !sentEver.has(offer.id) && !row,
      };
    })
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        byDesc(a.roi, b.roi) ||
        b.sales - a.sales ||
        a.offer.localeCompare(b.offer),
    );
}

export interface RankedCountry {
  country: string;
  roi: number | null;
  leadToSale: number | null;
  sales: number;
}

/** "Top countries for an offer": where it was sent in the period, best ROI first. */
export function rankCountriesForOffer(
  period: readonly OfferCountryRow[],
  offerId: string,
): RankedCountry[] {
  return period
    .filter((r) => r.offerId === offerId)
    .map((r) => ({ country: r.country, roi: roi(r), leadToSale: leadToSale(r), sales: r.sales }))
    .sort(
      (a, b) => byDesc(a.roi, b.roi) || b.sales - a.sales || a.country.localeCompare(b.country),
    );
}

export interface CreatorList {
  listId: string;
  name: string;
  country: string;
  provider: string | null;
  numbersCount: number;
}

/** What one list did with one offer. */
export interface ListOfferPair {
  listId: string;
  offerId: string;
  sent: number;
  sales: number;
  lastSentAt: Date | null;
}

export interface RankedList extends CreatorList {
  /** True when this list was never sent this offer, in any period. */
  neverSent: boolean;
  lastSentAt: Date | null;
  /** Sales of the offer on this list inside the period. */
  sales: number;
}

/**
 * The lists of a country for an offer: the ones never sent to it first (largest first), then
 * the others by their sales in the period.
 */
export function rankListsForOffer(
  lists: readonly CreatorList[],
  ever: readonly ListOfferPair[],
  period: readonly ListOfferPair[],
  offerId: string,
  country: string,
): RankedList[] {
  const find = (pairs: readonly ListOfferPair[], listId: string) =>
    pairs.find((p) => p.listId === listId && p.offerId === offerId);
  return lists
    .filter((l) => l.country === country)
    .map((l) => {
      const before = find(ever, l.listId);
      return {
        ...l,
        neverSent: !before || before.sent === 0,
        lastSentAt: before?.lastSentAt ?? null,
        sales: find(period, l.listId)?.sales ?? 0,
      };
    })
    .sort(
      (a, b) =>
        Number(b.neverSent) - Number(a.neverSent) ||
        (a.neverSent ? b.numbersCount - a.numbersCount : b.sales - a.sales) ||
        a.name.localeCompare(b.name),
    );
}

/** "Trixino → UK_ZEN_3", cut to the 120 characters a campaign name may have. */
export function plannedCampaignName(offer: string, list: string): string {
  return `${offer} → ${list}`.slice(0, 120);
}

/** What the creator's last step submits: an offer, a list, a route and the day planned. */
export const plannedCampaignSchema = z.object({
  offerId: z.uuid(),
  listId: z.uuid(),
  routeId: z.uuid(),
  plannedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day"),
});
export type PlannedCampaignInput = z.infer<typeof plannedCampaignSchema>;

// ---------------------------------------------------------------------------
// Daily plan (D5-08)
// ---------------------------------------------------------------------------

/** A campaign planned for a day (`campaigns.planned_for`), with what is attached to it. */
export interface PlannedCampaignRow {
  campaignId: string;
  name: string;
  country: string;
  status: string;
  /** The campaign's offer (its link); null when none is attached. */
  offer: string | null;
  lists: string[];
  routes: string[];
  /** Numbers in the attached lists. */
  contacts: number;
  /** SMS the campaign has sent so far. */
  sent: number;
}

export const PLAN_DIMENSIONS = ["country", "offer", "route"] as const;
export type PlanDimension = (typeof PLAN_DIMENSIONS)[number];

export interface PlanGroup {
  key: string;
  campaigns: number;
  contacts: number;
}

/** The day's campaigns and contacts per country, offer or route, most contacts first. */
export function planGroups(rows: readonly PlannedCampaignRow[], by: PlanDimension): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const row of rows) {
    const key =
      by === "country"
        ? row.country
        : by === "offer"
          ? (row.offer ?? "(no offer)")
          : row.routes.length > 0
            ? row.routes.join(" + ")
            : "(no route)";
    const group = groups.get(key) ?? { key, campaigns: 0, contacts: 0 };
    group.campaigns += 1;
    group.contacts += row.contacts;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.contacts - a.contacts || a.key.localeCompare(b.key));
}

export interface PlanTotals {
  campaigns: number;
  contacts: number;
  /** The organisation's daily SMS target; null when none is set. */
  target: number | null;
  /** Contacts planned minus the target: negative means the day is short. */
  difference: number | null;
}

export function planTotals(rows: readonly PlannedCampaignRow[], target: number | null): PlanTotals {
  const contacts = rows.reduce((n, r) => n + r.contacts, 0);
  return {
    campaigns: rows.length,
    contacts,
    target,
    difference: target === null ? null : contacts - target,
  };
}

/** The daily SMS target as typed: a whole number from 0 to ten million, or blank for none. */
export const dailyTargetSchema = z
  .union([z.string(), z.null()])
  .transform((value) => (value === null ? "" : value.trim()))
  .refine((value) => value === "" || /^\d{1,8}$/.test(value), {
    message: "The daily target is a whole number of SMS, or blank for none.",
  })
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value === null || value <= 10_000_000, {
    message: "The daily target is at most 10,000,000 SMS.",
  });

/** An ISO day moved by a number of days, in UTC. */
export function shiftIsoDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
