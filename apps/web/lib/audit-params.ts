import { parseIsoDay, parsePage } from "./billing-params";
import type { SearchParams } from "./lists-params";

export const AUDIT_PAGE_SIZE = 50;

/** Query-string state of the audit page: `/audit?action=list.flush&actor=<uuid>&from=…&to=…&page=2`. */
export interface AuditQuery {
  action: string;
  /** Local `users.id` or blank. */
  actor: string;
  from: string;
  to: string;
  page: number;
}

const ACTION = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parse the URL search params with safe defaults. */
export function parseAuditQuery(params: SearchParams): AuditQuery {
  const action = first(params.action).trim();
  const actor = first(params.actor).trim();
  return {
    action: ACTION.test(action) ? action : "",
    actor: UUID.test(actor) ? actor.toLowerCase() : "",
    from: parseIsoDay(params.from),
    to: parseIsoDay(params.to),
    page: parsePage(params.page),
  };
}

/** Build the query string for a state, leaving defaults out. */
export function auditQueryString(query: Partial<AuditQuery>): string {
  const params = new URLSearchParams();
  if (query.action) params.set("action", query.action);
  if (query.actor) params.set("actor", query.actor);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

const MAX_SUMMARY = 100;

function compactValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

/** `details` JSON as a one-line `key=value` list for the table; nested values are elided. */
export function summariseDetails(details: Record<string, unknown> | null): string {
  if (!details) return "";
  const text = Object.entries(details)
    .map(([key, value]) => `${key}=${compactValue(value)}`)
    .join(" ");
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text;
}
