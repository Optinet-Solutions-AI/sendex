import { eurToMicro } from "@sendex/core";
import type { CampaignStatus, ListCampaignsInput } from "@sendex/db";
import { dayRangeBounds, parseIsoDay, parsePage } from "./billing-params";
import type { SearchParams } from "./lists-params";

/**
 * Query-string state of the campaigns table (D3-06), shared by the page and the CSV export:
 * `/campaigns?search=roy&country=ES&status=sending&from=2026-09-01&to=2026-09-30
 *   &hasLeads=1&hasSales=1&noClicks=1&spendMin=10&spendMax=250&page=2`.
 */
export interface CampaignsQuery {
  search: string;
  country: string;
  status: CampaignStatus | "";
  /** Inclusive ISO day or blank. */
  from: string;
  /** Inclusive ISO day or blank. */
  to: string;
  hasLeads: boolean;
  hasSales: boolean;
  noClicks: boolean;
  /** EUR with up to two decimals, or blank. */
  spendMin: string;
  spendMax: string;
  page: number;
}

const STATUSES: readonly CampaignStatus[] = [
  "draft",
  "scheduled",
  "sending",
  "paused",
  "stopped",
  "completed",
];

const EUR = /^\d+(?:\.\d{1,2})?$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function flag(value: string | string[] | undefined): boolean {
  const text = first(value).trim().toLowerCase();
  return text === "1" || text === "true" || text === "on";
}

function eur(value: string | string[] | undefined): string {
  const text = first(value).trim();
  return EUR.test(text) ? text : "";
}

export function isCampaignStatus(value: string): value is CampaignStatus {
  return (STATUSES as readonly string[]).includes(value);
}

/** Parse the URL search params with safe defaults; anything malformed is dropped. */
export function parseCampaignsQuery(params: SearchParams): CampaignsQuery {
  const country = first(params.country).trim().toUpperCase();
  const status = first(params.status).trim();
  return {
    search: first(params.search).trim(),
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    status: isCampaignStatus(status) ? status : "",
    from: parseIsoDay(params.from),
    to: parseIsoDay(params.to),
    hasLeads: flag(params.hasLeads),
    hasSales: flag(params.hasSales),
    noClicks: flag(params.noClicks),
    spendMin: eur(params.spendMin),
    spendMax: eur(params.spendMax),
    page: parsePage(params.page),
  };
}

/** The query string for a state, leaving defaults out so the URL stays short. */
export function campaignsQueryString(query: Partial<CampaignsQuery>): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.country) params.set("country", query.country);
  if (query.status) params.set("status", query.status);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.hasLeads) params.set("hasLeads", "1");
  if (query.hasSales) params.set("hasSales", "1");
  if (query.noClicks) params.set("noClicks", "1");
  if (query.spendMin) params.set("spendMin", query.spendMin);
  if (query.spendMax) params.set("spendMax", query.spendMax);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** The `listCampaigns` input for a parsed query; unset filters are left out entirely. */
export function campaignsListInput(query: CampaignsQuery): ListCampaignsInput {
  const bounds = dayRangeBounds(query.from, query.to);
  return {
    page: query.page,
    ...(query.search ? { search: query.search } : {}),
    ...(query.country ? { country: query.country } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(bounds.from ? { from: bounds.from } : {}),
    ...(bounds.to ? { to: bounds.to } : {}),
    ...(query.hasLeads ? { hasLeads: true } : {}),
    ...(query.hasSales ? { hasSales: true } : {}),
    ...(query.noClicks ? { noClicks: true } : {}),
    ...(query.spendMin ? { spendMinMicro: eurToMicro(query.spendMin) } : {}),
    ...(query.spendMax ? { spendMaxMicro: eurToMicro(query.spendMax) } : {}),
  };
}
