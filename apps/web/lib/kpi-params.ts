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
