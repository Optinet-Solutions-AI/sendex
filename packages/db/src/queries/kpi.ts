import type { ListFollowUpRow } from "@sendex/core";
import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../types.js";
import { type DashboardFilter, inCountries, messageFacts, rowsOf } from "./dashboard.js";
import { listProviders } from "./lists.js";

/**
 * Read models of the KPI screens (D5-03 onwards). They sit on the dashboard's "message facts"
 * (queries/dashboard.ts), so the same rules hold: everything is scoped by organisation, sends,
 * leads and cost are windowed on the send time, sales and revenue on the deposit time (D4-17).
 */

export interface KpiFilter extends DashboardFilter {
  /** Only this route's sends. */
  routeId?: string | undefined;
  /** Only this offer's sends (a link). */
  linkId?: string | undefined;
  /** Part of a list name, any case. */
  search?: string | undefined;
}

const num = (v: unknown): number => Number(v ?? 0);
const big = (v: unknown): bigint => BigInt(String(v ?? "0").split(".")[0] ?? "0");
const date = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The route and offer conditions over a facts alias `f`. */
function factFilter(filter: KpiFilter): SQL {
  const parts: SQL[] = [];
  if (filter.routeId) parts.push(sql` and f.route_id = ${filter.routeId}`);
  if (filter.linkId) parts.push(sql` and f.link_id = ${filter.linkId}`);
  return sql.join(parts, sql``);
}

/**
 * Every list of the organisation that is not archived, with what it sent, cost and earned
 * inside the filters and when it was last sent inside them. A list with nothing in the
 * filters comes back with zeros and no last send: "never sent" (to that offer, on that route,
 * in those dates). `groupListFollowUp` in `@sendex/core` turns the rows into the table.
 */
export async function listFollowUp(
  db: Db,
  organisationId: string,
  filter: KpiFilter,
): Promise<ListFollowUpRow[]> {
  const search = filter.search?.trim();
  const named = search
    ? sql` and li.name ilike ${`%${search.replace(/[%_\\]/g, "\\$&")}%`}`
    : sql``;
  const rows = rowsOf(
    await db.execute(sql`
      with facts as (${messageFacts(organisationId, filter)})
      select li.id, li.name, li.country, li.provider, li.numbers_count, li.created_at,
        s.last_sent,
        coalesce(s.sent, 0) as sent, coalesce(s.leads, 0) as leads, coalesce(s.sales, 0) as sales,
        coalesce(s.cost, 0) as cost, coalesce(s.revenue, 0) as revenue
      from lists li
      left join (
        select f.list_id, max(f.sent_at) as last_sent, sum(f.sent) as sent, sum(f.leads) as leads,
          sum(f.sales) as sales, sum(f.cost) as cost, sum(f.revenue) as revenue
        from facts f
        where true${factFilter(filter)}
        group by f.list_id
      ) s on s.list_id = li.id
      where li.organisation_id = ${organisationId} and li.archived_at is null${inCountries(sql`li.country`, filter.countries)}${named}
      order by li.country, li.name`),
  );
  return rows.map((r) => ({
    listId: String(r.id),
    name: String(r.name),
    country: String(r.country),
    provider: r.provider === null || r.provider === undefined ? null : String(r.provider),
    numbersCount: num(r.numbers_count),
    lastSentAt: date(r.last_sent),
    createdAt: date(r.created_at) ?? new Date(0),
    sent: num(r.sent),
    leads: num(r.leads),
    sales: num(r.sales),
    costMicro: big(r.cost),
    revenueMicro: big(r.revenue),
  }));
}

export interface KpiOption {
  id: string;
  name: string;
}

export interface KpiFilterOptions {
  /** Routes the organisation has sent through. */
  routes: KpiOption[];
  /** The organisation's offers (links). */
  offers: KpiOption[];
  /** Countries of its lists. */
  countries: string[];
  /** Data providers of its lists (D5-01). */
  providers: string[];
}

/** What the KPI filters can be set to. */
export async function kpiFilterOptions(db: Db, organisationId: string): Promise<KpiFilterOptions> {
  const [routeRows, offerRows, countryRows, providers] = await Promise.all([
    db.execute(sql`
      select distinct r.id, r.name from laps l join routes r on r.id = l.route_id
      where l.organisation_id = ${organisationId} order by r.name`),
    db.execute(sql`
      select id, name from links where organisation_id = ${organisationId} order by name`),
    db.execute(sql`
      select distinct country from lists
      where organisation_id = ${organisationId} and archived_at is null order by country`),
    listProviders(db, organisationId),
  ]);
  return {
    routes: rowsOf(routeRows).map((r) => ({ id: String(r.id), name: String(r.name) })),
    offers: rowsOf(offerRows).map((r) => ({ id: String(r.id), name: String(r.name) })),
    countries: rowsOf(countryRows).map((r) => String(r.country)),
    providers,
  };
}
