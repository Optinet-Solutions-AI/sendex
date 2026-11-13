import { type CampaignSort, eurToMicro, isCampaignSort } from "@sendex/core";
import type { CampaignStatus, ListCampaignsInput } from "@sendex/db";
import { dayRangeBounds, parseIsoDay, parsePage } from "./billing-params";
import type { SearchParams } from "./lists-params";

/**
 * Query-string state of the campaigns table (D3-06), shared by the page and the CSV export:
 * `/campaigns?search=roy&country=ES&country=FR&status=sending&from=2026-09-01&to=2026-09-30
 *   &hasLeads=1&hasSales=1&noClicks=1&spendMin=10&spendMax=250&page=2&sort=sent&dir=asc`.
 */
export interface CampaignsQuery {
  search: string;
  /** ISO-2 codes from one or more `country` params; empty means all countries. */
  countries: string[];
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
  /** The id of an offer (tracked link), or blank (D4-13). */
  offer: string;
  /** Part of a sender id, or blank. */
  sender: string;
  /** Whole numbers as text, or blank: at least so many clicks, leads or sales. */
  clicksMin: string;
  leadsMin: string;
  salesMin: string;
  page: number;
  /** Sort column, or blank for newest first (D4-10). */
  sort: CampaignSort | "";
  dir: "asc" | "desc";
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHOLE = /^\d{1,9}$/;

function whole(value: string | string[] | undefined): string {
  const text = first(value).trim();
  return WHOLE.test(text) ? String(Number(text)) : "";
}

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

/** Every `country` value (repeated params or comma-separated), upper-cased, valid and unique. */
function countries(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const codes = raw
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toUpperCase())
    .filter((v) => /^[A-Z]{2}$/.test(v));
  return [...new Set(codes)];
}

export function isCampaignStatus(value: string): value is CampaignStatus {
  return (STATUSES as readonly string[]).includes(value);
}

/** Parse the URL search params with safe defaults; anything malformed is dropped. */
export function parseCampaignsQuery(params: SearchParams): CampaignsQuery {
  const status = first(params.status).trim();
  const sort = first(params.sort).trim();
  const offer = first(params.offer).trim();
  return {
    search: first(params.search).trim(),
    countries: countries(params.country),
    status: isCampaignStatus(status) ? status : "",
    from: parseIsoDay(params.from),
    to: parseIsoDay(params.to),
    hasLeads: flag(params.hasLeads),
    hasSales: flag(params.hasSales),
    noClicks: flag(params.noClicks),
    spendMin: eur(params.spendMin),
    spendMax: eur(params.spendMax),
    offer: UUID.test(offer) ? offer.toLowerCase() : "",
    sender: first(params.sender).trim().slice(0, 20),
    clicksMin: whole(params.clicksMin),
    leadsMin: whole(params.leadsMin),
    salesMin: whole(params.salesMin),
    page: parsePage(params.page),
    sort: isCampaignSort(sort) ? sort : "",
    dir: first(params.dir).trim() === "asc" ? "asc" : "desc",
  };
}

/** The query string for a state, leaving defaults out so the URL stays short. */
export function campaignsQueryString(query: Partial<CampaignsQuery>): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  for (const code of query.countries ?? []) params.append("country", code);
  if (query.status) params.set("status", query.status);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.hasLeads) params.set("hasLeads", "1");
  if (query.hasSales) params.set("hasSales", "1");
  if (query.noClicks) params.set("noClicks", "1");
  if (query.spendMin) params.set("spendMin", query.spendMin);
  if (query.spendMax) params.set("spendMax", query.spendMax);
  if (query.offer) params.set("offer", query.offer);
  if (query.sender) params.set("sender", query.sender);
  if (query.clicksMin) params.set("clicksMin", query.clicksMin);
  if (query.leadsMin) params.set("leadsMin", query.leadsMin);
  if (query.salesMin) params.set("salesMin", query.salesMin);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.sort) params.set("sort", query.sort);
  if (query.sort && query.dir === "asc") params.set("dir", "asc");
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** The `listCampaigns` input for a parsed query; unset filters are left out entirely. */
export function campaignsListInput(query: CampaignsQuery): ListCampaignsInput {
  const bounds = dayRangeBounds(query.from, query.to);
  return {
    page: query.page,
    ...(query.search ? { search: query.search } : {}),
    ...(query.countries.length > 0 ? { countries: query.countries } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(bounds.from ? { from: bounds.from } : {}),
    ...(bounds.to ? { to: bounds.to } : {}),
    ...(query.hasLeads ? { hasLeads: true } : {}),
    ...(query.hasSales ? { hasSales: true } : {}),
    ...(query.noClicks ? { noClicks: true } : {}),
    ...(query.spendMin ? { spendMinMicro: eurToMicro(query.spendMin) } : {}),
    ...(query.spendMax ? { spendMaxMicro: eurToMicro(query.spendMax) } : {}),
    ...(query.offer ? { linkId: query.offer } : {}),
    ...(query.sender ? { senderId: query.sender } : {}),
    ...(query.clicksMin ? { clicksMin: Number(query.clicksMin) } : {}),
    ...(query.leadsMin ? { leadsMin: Number(query.leadsMin) } : {}),
    ...(query.salesMin ? { salesMin: Number(query.salesMin) } : {}),
    ...(query.sort ? { sort: query.sort, dir: query.dir } : {}),
  };
}
