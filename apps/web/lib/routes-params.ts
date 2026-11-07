import { parseIsoDay, parsePage } from "./billing-params";
import { parseCountries } from "./campaigns-log-params";
import type { SearchParams } from "./lists-params";

/**
 * Query-string state of the Routes pages (D4-06): Platform Routes (`?country=ES&q=375&range=30d`),
 * Custom Routes (`?tab=stats`), Testing (`?country=AD&removed=1&singles=1&page=2`) and
 * Mobile Networks (`?country=FR&route=<id>&q=orange&range=7d&low=1`).
 */
export const ROUTE_RANGES = ["all", "7d", "30d", "90d", "custom"] as const;
export type RouteRange = (typeof ROUTE_RANGES)[number];

export const CUSTOM_ROUTE_TABS = ["routes", "routing", "stats"] as const;
export type CustomRouteTab = (typeof CUSTOM_ROUTE_TABS)[number];

export interface RoutesQuery {
  countries: string[];
  /** Route ids (Mobile Networks route filter). */
  routes: string[];
  q: string;
  range: RouteRange;
  from: string;
  to: string;
  tab: CustomRouteTab;
  showRemoved: boolean;
  singlesOnly: boolean;
  /** Mobile Networks: show low-volume operators. */
  showLow: boolean;
  page: number;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function flag(value: string | string[] | undefined): boolean {
  const v = first(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

function uuids(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(raw.filter((v) => /^[0-9a-f-]{36}$/i.test(v)).map((v) => v.toLowerCase()))];
}

export function parseRoutesQuery(
  params: SearchParams,
  defaultRange: RouteRange = "all",
): RoutesQuery {
  const range = first(params.range).trim();
  const tab = first(params.tab).trim();
  return {
    countries: parseCountries(params.country),
    routes: uuids(params.route),
    q: first(params.q).trim(),
    range: (ROUTE_RANGES as readonly string[]).includes(range)
      ? (range as RouteRange)
      : defaultRange,
    from: parseIsoDay(params.from),
    to: parseIsoDay(params.to),
    tab: (CUSTOM_ROUTE_TABS as readonly string[]).includes(tab)
      ? (tab as CustomRouteTab)
      : "routes",
    showRemoved: flag(params.removed),
    singlesOnly: flag(params.singles),
    showLow: flag(params.low),
    page: parsePage(params.page),
  };
}

export function routesQueryString(
  query: Partial<RoutesQuery>,
  defaultRange: RouteRange = "all",
): string {
  const p = new URLSearchParams();
  for (const c of query.countries ?? []) p.append("country", c);
  for (const r of query.routes ?? []) p.append("route", r);
  if (query.q) p.set("q", query.q);
  if (query.range && query.range !== defaultRange) p.set("range", query.range);
  if (query.range === "custom") {
    if (query.from) p.set("from", query.from);
    if (query.to) p.set("to", query.to);
  }
  if (query.tab && query.tab !== "routes") p.set("tab", query.tab);
  if (query.showRemoved) p.set("removed", "1");
  if (query.singlesOnly) p.set("singles", "1");
  if (query.showLow) p.set("low", "1");
  if (query.page && query.page > 1) p.set("page", String(query.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const DAY_MS = 86_400_000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The UTC window of a range, end exclusive; `all` is open. */
export function routesWindow(query: RoutesQuery, now = new Date()): { from?: Date; to?: Date } {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  switch (query.range) {
    case "all":
      return {};
    case "7d":
      return { from: new Date(today.getTime() - 6 * DAY_MS), to: tomorrow };
    case "30d":
      return { from: new Date(today.getTime() - 29 * DAY_MS), to: tomorrow };
    case "90d":
      return { from: new Date(today.getTime() - 89 * DAY_MS), to: tomorrow };
    case "custom": {
      const w: { from?: Date; to?: Date } = {};
      if (query.from) w.from = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) w.to = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS);
      return w;
    }
  }
}

/** "All time", "Last 30 days" or the custom days, for a card's period label. */
export function describeRouteRange(query: RoutesQuery): string {
  switch (query.range) {
    case "all":
      return "All time";
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "custom":
      return `${query.from || "…"} → ${query.to || "…"}`;
  }
}
