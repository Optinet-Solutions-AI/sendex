import { isLedgerKind, type LedgerKind } from "@sendex/core";
import type { SearchParams } from "./lists-params";

export const BILLING_TABS = ["deposits", "transactions", "summary"] as const;
export type BillingTab = (typeof BILLING_TABS)[number];

export const BILLING_PAGE_SIZE = 50;

/** Query-string state of the billing page: `/billing?tab=transactions&kind=debit&from=…&to=…&page=2`. */
export interface BillingQuery {
  tab: BillingTab;
  kind: LedgerKind | "";
  /** Inclusive ISO day or blank. */
  from: string;
  /** Inclusive ISO day or blank. */
  to: string;
  page: number;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function isTab(value: string): value is BillingTab {
  return (BILLING_TABS as readonly string[]).includes(value);
}

/** An ISO day (YYYY-MM-DD) or blank. */
export function parseIsoDay(value: string | string[] | undefined): string {
  const text = first(value).trim();
  return ISO_DAY.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? text : "";
}

/** A 1-based page number, 1 when missing or invalid. */
export function parsePage(value: string | string[] | undefined): number {
  const n = Number.parseInt(first(value), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Parse the URL search params with safe defaults. */
export function parseBillingQuery(params: SearchParams): BillingQuery {
  const tabRaw = first(params.tab);
  const kindRaw = first(params.kind);
  return {
    tab: isTab(tabRaw) ? tabRaw : "deposits",
    kind: isLedgerKind(kindRaw) ? kindRaw : "",
    from: parseIsoDay(params.from),
    to: parseIsoDay(params.to),
    page: parsePage(params.page),
  };
}

/** Build the query string for a state, leaving defaults out. */
export function billingQueryString(query: Partial<BillingQuery>): string {
  const params = new URLSearchParams();
  if (query.tab && query.tab !== "deposits") params.set("tab", query.tab);
  if (query.kind) params.set("kind", query.kind);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export interface DayRangeBounds {
  from: Date | undefined;
  /** Exclusive: the start of the day after `to`. */
  to: Date | undefined;
}

/** Inclusive ISO days (UTC) to the `[from, to)` instants the queries take. */
export function dayRangeBounds(from: string, to: string): DayRangeBounds {
  return {
    from: from ? new Date(`${from}T00:00:00Z`) : undefined,
    to: to ? new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) : undefined,
  };
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Summary tab's default range: the last thirty days up to today (UTC), inclusive. */
export function defaultSummaryRange(today = new Date()): { from: string; to: string } {
  const end = new Date(`${isoDay(today)}T00:00:00Z`);
  const start = new Date(end.getTime() - 30 * 86_400_000);
  return { from: isoDay(start), to: isoDay(end) };
}
