import { type SalesResultSort, TREND_DIMENSIONS, type TrendDimension } from "@sendex/core";
import type { KpiFilter } from "@sendex/db";
import { parseIsoDay } from "./billing-params";
import { parseCountries } from "./campaigns-log-params";
import type { SearchParams } from "./lists-params";

/**
 * Query-string state of the KPI screens (D5-03 onwards). List Follow-Up:
 * `/kpi/list-follow-up?q=zen&route=<id>&offer=<id>&country=GB&from=2026-11-01&to=2026-11-16`.
 */
export interface ListFollowUpQuery {
  /** Part of a list name. */
  q: string;
  /** A route id, or empty for every route. */
  route: string;
  /** An offer (link) id, or empty for every offer. */
  offer: string;
  /** ISO-2 codes; empty means every country. */
  countries: string[];
  /** Inclusive ISO days; empty means no bound. */
  from: string;
  to: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseId(value: string | string[] | undefined): string {
  const text = first(value).trim();
  return UUID.test(text) ? text : "";
}

export function parseListFollowUpQuery(params: SearchParams): ListFollowUpQuery {
  return {
    q: first(params.q).trim().slice(0, 100),
    route: parseId(params.route),
    offer: parseId(params.offer),
    countries: parseCountries(params.country),
    from: parseIsoDay(params.from),
    to: parseIsoDay(params.to),
  };
}

export function listFollowUpQueryString(query: Partial<ListFollowUpQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.route) params.set("route", query.route);
  if (query.offer) params.set("offer", query.offer);
  for (const code of query.countries ?? []) params.append("country", code);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The database filter of a query: whole UTC days, the end day included. */
export function followUpFilter(query: ListFollowUpQuery): KpiFilter {
  return {
    ...(query.from ? { from: new Date(`${query.from}T00:00:00.000Z`) } : {}),
    ...(query.to ? { to: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS) } : {}),
    countries: query.countries,
    ...(query.route ? { routeId: query.route } : {}),
    ...(query.offer ? { linkId: query.offer } : {}),
    ...(query.q ? { search: query.q } : {}),
  };
}

// ---------------------------------------------------------------------------
// Performance Insight (D5-04): `/kpi/insight?period=month&year=2026&month=11&sort=sales`
// ---------------------------------------------------------------------------

export const INSIGHT_PERIODS = ["month", "year", "all"] as const;
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];
export type InsightSort = "roi" | "sales";

/** A month, a year or all time: the period control shared by the KPI screens. */
export interface PeriodQuery {
  period: InsightPeriod;
  year: number;
  /** 1 to 12; only used when `period` is `month`. */
  month: number;
}

export interface InsightQuery extends PeriodQuery {
  /** How "Offer performance by country" ranks the offers. */
  sort: InsightSort;
}

/** The first year the selects offer; nothing was sent before it. */
export const INSIGHT_FIRST_YEAR = 2025;

export function parseInsightQuery(params: SearchParams, now = new Date()): InsightQuery {
  const period = first(params.period).trim();
  const year = Number.parseInt(first(params.year), 10);
  const month = Number.parseInt(first(params.month), 10);
  const thisYear = now.getUTCFullYear();
  return {
    period: (INSIGHT_PERIODS as readonly string[]).includes(period)
      ? (period as InsightPeriod)
      : "month",
    year: Number.isFinite(year) && year >= INSIGHT_FIRST_YEAR && year <= thisYear ? year : thisYear,
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : now.getUTCMonth() + 1,
    sort: first(params.sort) === "sales" ? "sales" : "roi",
  };
}

function periodParams(query: PeriodQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.period !== "month") params.set("period", query.period);
  if (query.period !== "all") params.set("year", String(query.year));
  if (query.period === "month") params.set("month", String(query.month));
  return params;
}

export function insightQueryString(query: InsightQuery): string {
  const params = periodParams(query);
  if (query.sort !== "roi") params.set("sort", query.sort);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The UTC window of the period, end exclusive; empty for all time. */
export function insightWindow(query: PeriodQuery): { from?: Date; to?: Date } {
  if (query.period === "month") {
    return {
      from: new Date(Date.UTC(query.year, query.month - 1, 1)),
      to: new Date(Date.UTC(query.year, query.month, 1)),
    };
  }
  if (query.period === "year") {
    return {
      from: new Date(Date.UTC(query.year, 0, 1)),
      to: new Date(Date.UTC(query.year + 1, 0, 1)),
    };
  }
  return {};
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "November 2026", "2026" or "All time". */
export function insightLabel(query: PeriodQuery): string {
  if (query.period === "month") return `${MONTH_NAMES[query.month - 1] ?? ""} ${query.year}`;
  if (query.period === "year") return String(query.year);
  return "All time";
}

// ---------------------------------------------------------------------------
// Sales Results (D5-05): `/kpi/sales-results?period=month&year=2026&month=11&sort=day`
// ---------------------------------------------------------------------------

export const SALES_RESULT_SORTS = ["sales", "day", "leads", "revenue"] as const;

export interface SalesResultsQuery extends PeriodQuery {
  /** The column the table is ordered by, largest or latest first. */
  sort: SalesResultSort;
}

export function parseSalesResultsQuery(params: SearchParams, now = new Date()): SalesResultsQuery {
  const { period, year, month } = parseInsightQuery(params, now);
  const sort = first(params.sort);
  return {
    period,
    year,
    month,
    sort: (SALES_RESULT_SORTS as readonly string[]).includes(sort)
      ? (sort as SalesResultSort)
      : "sales",
  };
}

export function salesResultsQueryString(query: SalesResultsQuery): string {
  const params = periodParams(query);
  if (query.sort !== "sales") params.set("sort", query.sort);
  const text = params.toString();
  return text ? `?${text}` : "";
}

// ---------------------------------------------------------------------------
// Trends (D5-06): `/kpi/trends?year=2026&month=11&by=offer&mode=daily&compare=0`
// ---------------------------------------------------------------------------

export interface TrendsQuery {
  year: number;
  /** 1 to 12. */
  month: number;
  /** What the breakdown table groups by. */
  by: TrendDimension;
  /** Running totals (the default) or the figures of each day. */
  cumulative: boolean;
  /** Draw the month before next to the month. */
  compare: boolean;
}

export function parseTrendsQuery(params: SearchParams, now = new Date()): TrendsQuery {
  const { year, month } = parseInsightQuery(params, now);
  const by = first(params.by);
  return {
    year,
    month,
    by: (TREND_DIMENSIONS as readonly string[]).includes(by) ? (by as TrendDimension) : "route",
    cumulative: first(params.mode) !== "daily",
    compare: first(params.compare) !== "0",
  };
}

export function trendsQueryString(query: TrendsQuery): string {
  const params = new URLSearchParams();
  params.set("year", String(query.year));
  params.set("month", String(query.month));
  if (query.by !== "route") params.set("by", query.by);
  if (!query.cumulative) params.set("mode", "daily");
  if (!query.compare) params.set("compare", "0");
  return `?${params.toString()}`;
}

/** The UTC windows of the month and of the month before, ends exclusive. */
export function trendsWindows(query: Pick<TrendsQuery, "year" | "month">): {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date };
} {
  const start = (offset: number) => new Date(Date.UTC(query.year, query.month - 1 + offset, 1));
  return {
    current: { from: start(0), to: start(1) },
    previous: { from: start(-1), to: start(0) },
  };
}
