import { parseIsoDay, parsePage } from "./billing-params";
import { parseCountries } from "./campaigns-log-params";
import type { SearchParams } from "./lists-params";

/**
 * Query-string state of the dashboard (D4-05): `/?tab=overview&range=30d&country=ES`,
 * `?tab=assets&asset=offers&q=trix`, `?tab=contacts&threshold=3&lists=2`,
 * `?tab=roi`, `?tab=countries`, `?tab=api`. Nothing set opens Getting Started, all time,
 * every country.
 */
export const DASHBOARD_TABS = [
  "getting-started",
  "overview",
  "roi",
  "countries",
  "contacts",
  "assets",
  "api",
] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const DASHBOARD_RANGES = ["all", "30d", "90d", "custom"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const ASSET_TABS = ["texts", "offers", "sids"] as const;
export type AssetTab = (typeof ASSET_TABS)[number];

export const DEFAULT_THRESHOLD = 3;

export interface DashboardQuery {
  tab: DashboardTab;
  range: DashboardRange;
  /** Inclusive ISO days, only used when `range` is `custom`. */
  from: string;
  to: string;
  countries: string[];
  asset: AssetTab;
  /** The asset search box. */
  q: string;
  /** "Sent fewer than [n] times" on the Contacts tab. */
  threshold: number;
  /** The Lists card page on the Contacts tab. */
  listsPage: number;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function oneOf<T extends string>(values: readonly T[], raw: string, fallback: T): T {
  return (values as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function parseDashboardQuery(params: SearchParams): DashboardQuery {
  const thresholdRaw = Number.parseInt(first(params.threshold), 10);
  return {
    tab: oneOf(DASHBOARD_TABS, first(params.tab).trim(), "getting-started"),
    range: oneOf(DASHBOARD_RANGES, first(params.range).trim(), "all"),
    from: parseIsoDay(params.from),
    to: parseIsoDay(params.to),
    countries: parseCountries(params.country),
    asset: oneOf(ASSET_TABS, first(params.asset).trim(), "texts"),
    q: first(params.q).trim(),
    threshold:
      Number.isFinite(thresholdRaw) && thresholdRaw >= 0 && thresholdRaw <= 1000
        ? thresholdRaw
        : DEFAULT_THRESHOLD,
    listsPage: parsePage(params.lists),
  };
}

export function dashboardQueryString(query: Partial<DashboardQuery>): string {
  const params = new URLSearchParams();
  if (query.tab && query.tab !== "getting-started") params.set("tab", query.tab);
  if (query.range && query.range !== "all") params.set("range", query.range);
  if (query.range === "custom") {
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
  }
  for (const code of query.countries ?? []) params.append("country", code);
  if (query.tab === "assets") {
    if (query.asset && query.asset !== "texts") params.set("asset", query.asset);
    if (query.q) params.set("q", query.q);
  }
  if (query.tab === "contacts") {
    if (query.threshold !== undefined && query.threshold !== DEFAULT_THRESHOLD) {
      params.set("threshold", String(query.threshold));
    }
    if (query.listsPage && query.listsPage > 1) params.set("lists", String(query.listsPage));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

const DAY_MS = 86_400_000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export interface DashboardWindow {
  from?: Date;
  to?: Date;
}

/** The UTC window the range selects, end exclusive; all time is open on both sides. */
export function dashboardWindow(query: DashboardQuery, now = new Date()): DashboardWindow {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  switch (query.range) {
    case "all":
      return {};
    case "30d":
      return { from: new Date(today.getTime() - 29 * DAY_MS), to: tomorrow };
    case "90d":
      return { from: new Date(today.getTime() - 89 * DAY_MS), to: tomorrow };
    case "custom": {
      const bounds: DashboardWindow = {};
      if (query.from) bounds.from = new Date(`${query.from}T00:00:00.000Z`);
      if (query.to) bounds.to = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS);
      return bounds;
    }
  }
}

/** "2026-10-08 → 2026-11-07 (last 30 days)" for the ROI subtitle; "all time" when open. */
export function describeWindow(query: DashboardQuery, now = new Date()): string {
  const w = dashboardWindow(query, now);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (!w.from && !w.to) return "all time";
  const from = w.from ? iso(w.from) : "…";
  const to = w.to ? iso(new Date(w.to.getTime() - DAY_MS)) : "…";
  const note =
    query.range === "30d" ? " (last 30 days)" : query.range === "90d" ? " (last 90 days)" : "";
  return `${from} → ${to}${note}`;
}
