import type { PostbackType } from "@sendex/core";

/**
 * Query-string state of the postback log:
 * `/reports/postbacks?type=lead&range=7d&search=abc&page=2` or `range=custom&from=…&to=…`.
 */
export const POSTBACK_RANGES = ["all", "today", "7d", "30d", "90d", "custom"] as const;
export type PostbackRange = (typeof POSTBACK_RANGES)[number];

export const POSTBACK_TYPE_FILTERS = ["all", "lead", "sale"] as const;
export type PostbackTypeFilter = (typeof POSTBACK_TYPE_FILTERS)[number];

export interface PostbacksQuery {
  type: PostbackTypeFilter;
  range: PostbackRange;
  /** ISO date (yyyy-mm-dd) bounds, only used when `range` is `custom`. */
  from: string;
  to: string;
  search: string;
  page: number;
}

export const POSTBACKS_PAGE_SIZE = 50;

export type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRange(value: string): value is PostbackRange {
  return (POSTBACK_RANGES as readonly string[]).includes(value);
}

function isTypeFilter(value: string): value is PostbackTypeFilter {
  return (POSTBACK_TYPE_FILTERS as readonly string[]).includes(value);
}

export function parsePostbacksQuery(params: SearchParams): PostbacksQuery {
  const typeRaw = first(params.type);
  const rangeRaw = first(params.range);
  const pageRaw = Number.parseInt(first(params.page), 10);
  const from = first(params.from);
  const to = first(params.to);
  return {
    type: isTypeFilter(typeRaw) ? typeRaw : "all",
    range: isRange(rangeRaw) ? rangeRaw : "all",
    from: ISO_DATE.test(from) ? from : "",
    to: ISO_DATE.test(to) ? to : "",
    search: first(params.search).trim(),
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
  };
}

export function postbacksQueryString(query: Partial<PostbacksQuery>): string {
  const params = new URLSearchParams();
  if (query.type && query.type !== "all") params.set("type", query.type);
  if (query.range && query.range !== "all") params.set("range", query.range);
  if (query.range === "custom") {
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
  }
  if (query.search) params.set("search", query.search);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export interface DateBounds {
  from?: Date;
  to?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The `received_at` bounds a range selects, in UTC. Relative ranges run from the start of
 * the day N-1 days ago (so "7 days" is today and the six days before) to now; a custom
 * range covers whole days from `from` to the end of `to`. Missing custom bounds are open.
 */
export function postbackDateBounds(query: PostbacksQuery, now = new Date()): DateBounds {
  const today = startOfUtcDay(now);
  switch (query.range) {
    case "all":
      return {};
    case "today":
      return { from: today };
    case "7d":
      return { from: new Date(today.getTime() - 6 * DAY_MS) };
    case "30d":
      return { from: new Date(today.getTime() - 29 * DAY_MS) };
    case "90d":
      return { from: new Date(today.getTime() - 89 * DAY_MS) };
    case "custom": {
      const bounds: DateBounds = {};
      if (query.from) bounds.from = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) bounds.to = new Date(`${query.to}T23:59:59.999Z`);
      return bounds;
    }
  }
}

/** The `type` argument for `listPostbacks`: undefined for "all". */
export function postbackTypeFilter(query: PostbacksQuery): PostbackType | undefined {
  return query.type === "all" ? undefined : query.type;
}
