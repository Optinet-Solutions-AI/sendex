import { parseIsoDay, parsePage } from "./billing-params";
import type { SearchParams } from "./lists-params";

/**
 * Query-string state of the Campaigns Log (D4-05):
 * `/reports/campaigns-log?period=7d&country=ES&country=GB&page=2` or
 * `period=custom&from=2026-11-01&to=2026-11-07`.
 */
export const LOG_PERIODS = ["today", "7d", "30d", "custom"] as const;
export type LogPeriod = (typeof LOG_PERIODS)[number];

export const LOG_PAGE_SIZE = 50;

export interface CampaignsLogQuery {
  period: LogPeriod;
  /** Inclusive ISO days, only used when `period` is `custom`. */
  from: string;
  to: string;
  /** ISO-2 codes; empty means every country. */
  countries: string[];
  page: number;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function isPeriod(value: string): value is LogPeriod {
  return (LOG_PERIODS as readonly string[]).includes(value);
}

/** Every `country` value (repeated params or comma-separated), upper-cased, valid and unique. */
export function parseCountries(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const codes = raw
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toUpperCase())
    .filter((v) => /^[A-Z]{2}$/.test(v));
  return [...new Set(codes)];
}

export function parseCampaignsLogQuery(params: SearchParams): CampaignsLogQuery {
  const period = first(params.period).trim();
  return {
    period: isPeriod(period) ? period : "7d",
    from: parseIsoDay(params.from),
    to: parseIsoDay(params.to),
    countries: parseCountries(params.country),
    page: parsePage(params.page),
  };
}

export function campaignsLogQueryString(query: Partial<CampaignsLogQuery>): string {
  const params = new URLSearchParams();
  if (query.period && query.period !== "7d") params.set("period", query.period);
  if (query.period === "custom") {
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
  }
  for (const code of query.countries ?? []) params.append("country", code);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

const DAY_MS = 86_400_000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The UTC window a period selects, end exclusive: today; the last 7 or 30 days including
 * today; or whole custom days (a missing custom bound falls back to the last 30 days).
 */
export function logWindow(query: CampaignsLogQuery, now = new Date()): { from: Date; to: Date } {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  switch (query.period) {
    case "today":
      return { from: today, to: tomorrow };
    case "7d":
      return { from: new Date(today.getTime() - 6 * DAY_MS), to: tomorrow };
    case "30d":
      return { from: new Date(today.getTime() - 29 * DAY_MS), to: tomorrow };
    case "custom": {
      const from = query.from
        ? new Date(`${query.from}T00:00:00.000Z`)
        : new Date(today.getTime() - 29 * DAY_MS);
      const to = query.to ? new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS : tomorrow;
      return { from, to: new Date(to) };
    }
  }
}
