import type { CountryDayStats, LogCounters, LogKpis } from "@sendex/core";
import { logKpis } from "@sendex/core";
import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../types.js";

/**
 * The daily send read model behind the Campaigns Log and the Send Calendar (D4-05): every
 * submitted message of the organisation, grouped by UTC day × campaign × country × list ×
 * route, with the clicks, leads, sales and ledger spend of those messages. Computed live
 * from `messages` (so the calendar is always current) with the indexes of migration 0016;
 * a materialised daily table can replace the CTE later without changing callers.
 *
 * "Sent" means submitted to the carrier (status sent, delivered or expired), as on the
 * campaign page. A conversion counts on the day its message was sent, not the day the
 * postback arrived, so every row reconciles with its own sends.
 */

export interface SendLogFilter {
  /** Inclusive, UTC. */
  from: Date;
  /** Exclusive, UTC. */
  to: Date;
  /** ISO-2 codes; empty or undefined means every country. */
  countries?: readonly string[] | undefined;
}

export interface SendLogRow extends LogCounters {
  day: string;
  campaignId: string | null;
  /** Null for sends without a campaign ("(API / no campaign)"). */
  campaignName: string | null;
  country: string;
  listId: string | null;
  listName: string | null;
  routeId: string;
  routeName: string;
  ctr: number;
  cpcMicro: bigint | null;
}

export interface SendLogPage {
  rows: SendLogRow[];
  total: number;
  kpis: LogKpis;
}

/** `db.execute` returns a row list on postgres-js and `{ rows }` on PGlite. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybe = result as { rows?: Record<string, unknown>[] };
  return maybe.rows ?? [];
}

const num = (v: unknown): number => Number(v ?? 0);
const big = (v: unknown): bigint => BigInt(String(v ?? "0"));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** `YYYY-MM-DD` whatever the driver hands back for a `date` column. */
function dayOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function countryFilter(countries: readonly string[] | undefined): SQL {
  const codes = (countries ?? []).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  if (codes.length === 0) return sql``;
  return sql` and coalesce(li.country, c.country) in (${sql.join(
    codes.map((c) => sql`${c}`),
    sql`, `,
  )})`;
}

/**
 * One row per submitted message in the window with its day, dimensions and counters:
 * clicked (any click), leads, sales and ledger cost. Aliases: `m` messages, `l` laps,
 * `li` lists, `c` campaigns.
 */
function perMessage(organisationId: string, filter: SendLogFilter): SQL {
  return sql`
    select m.id,
      (m.sent_at at time zone 'UTC')::date as day,
      m.campaign_id,
      coalesce(li.country, c.country) as country,
      l.list_id,
      m.route_id,
      exists (select 1 from clicks ck where ck.message_id = m.id and ck.device is distinct from 'bot') as clicked,
      (select count(*) from postbacks p where p.message_id = m.id and p.type = 'lead') as leads,
      (select count(*) from postbacks p where p.message_id = m.id and p.type = 'sale') as sales,
      (select coalesce(-sum(le.amount_micro), 0) from ledger_entries le
         where le.reference_type = 'message' and le.reference_id = m.id::text) as cost
    from messages m
    join laps l on l.id = m.lap_id
    left join lists li on li.id = l.list_id
    left join campaigns c on c.id = m.campaign_id
    where m.organisation_id = ${organisationId}
      and m.status in ('sent', 'delivered', 'expired')
      and m.sent_at >= ${filter.from.toISOString()}::timestamptz
      and m.sent_at < ${filter.to.toISOString()}::timestamptz${countryFilter(filter.countries)}`;
}

/** The grouped log: day × campaign × country × list × route. */
function grouped(organisationId: string, filter: SendLogFilter): SQL {
  return sql`
    select pm.day, pm.campaign_id, pm.country, pm.list_id, pm.route_id,
      count(*)::int as sent,
      count(*) filter (where pm.clicked)::int as clicks,
      sum(pm.leads)::int as leads,
      sum(pm.sales)::int as sales,
      sum(pm.cost)::bigint as spend
    from (${perMessage(organisationId, filter)}) pm
    group by pm.day, pm.campaign_id, pm.country, pm.list_id, pm.route_id`;
}

export interface SendLogInput extends SendLogFilter {
  page: number;
  pageSize: number;
}

/** The Campaigns Log page: rows newest day first, busiest first within a day, with totals. */
export async function sendLog(
  db: Db,
  organisationId: string,
  input: SendLogInput,
): Promise<SendLogPage> {
  const pageSize = Math.max(1, input.pageSize);
  const offset = Math.max(0, input.page - 1) * pageSize;
  const [pageRows, totalRows] = await Promise.all([
    db.execute(sql`
      with g as (${grouped(organisationId, input)})
      select g.*, c.name as campaign_name, li.name as list_name, r.name as route_name,
        count(*) over () as total
      from g
      left join campaigns c on c.id = g.campaign_id
      left join lists li on li.id = g.list_id
      left join routes r on r.id = g.route_id
      order by g.day desc, g.sent desc, c.name asc nulls last, li.name asc nulls last, r.name asc
      limit ${pageSize} offset ${offset}`),
    db.execute(sql`
      with g as (${grouped(organisationId, input)})
      select coalesce(sum(g.sent), 0)::int as sent, coalesce(sum(g.clicks), 0)::int as clicks,
        coalesce(sum(g.leads), 0)::int as leads, coalesce(sum(g.sales), 0)::int as sales,
        coalesce(sum(g.spend), 0)::bigint as spend, count(*)::int as total
      from g`),
  ]);
  const totals = rowsOf(totalRows)[0];
  const kpis = logKpis([
    {
      sent: num(totals?.sent),
      clicks: num(totals?.clicks),
      spendMicro: big(totals?.spend),
      leads: num(totals?.leads),
      sales: num(totals?.sales),
    },
  ]);
  const rows = rowsOf(pageRows).map((r): SendLogRow => {
    const sent = num(r.sent);
    const clicks = num(r.clicks);
    const spendMicro = big(r.spend);
    return {
      day: dayOf(r.day),
      campaignId: text(r.campaign_id),
      campaignName: text(r.campaign_name),
      country: String(r.country ?? ""),
      listId: text(r.list_id),
      listName: text(r.list_name),
      routeId: String(r.route_id),
      routeName: String(r.route_name ?? ""),
      sent,
      clicks,
      spendMicro,
      leads: num(r.leads),
      sales: num(r.sales),
      ctr: sent > 0 ? clicks / sent : 0,
      cpcMicro: clicks > 0 ? spendMicro / BigInt(clicks) : null,
    };
  });
  return { rows, total: num(totals?.total), kpis };
}

/** The calendar read model: sends per day × country in the window. */
export async function sendCalendar(
  db: Db,
  organisationId: string,
  filter: SendLogFilter,
): Promise<CountryDayStats[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select pm.day, pm.country,
        count(*)::int as sent,
        count(*) filter (where pm.clicked)::int as clicks,
        count(distinct pm.campaign_id)::int as campaigns
      from (${perMessage(organisationId, filter)}) pm
      group by pm.day, pm.country
      order by pm.day asc, sent desc`),
  );
  return rows.map((r) => ({
    day: dayOf(r.day),
    country: String(r.country ?? ""),
    sent: num(r.sent),
    clicks: num(r.clicks),
    campaigns: num(r.campaigns),
  }));
}

export interface CalendarDayCampaign {
  campaignId: string | null;
  campaignName: string | null;
  /** The name (or email) of the member who created the campaign. */
  account: string | null;
  sent: number;
  clicks: number;
  ctr: number;
  leads: number;
  sales: number;
}

/** The day modal: the campaigns that sent to `country` on `day` (UTC), busiest first. */
export async function sendCalendarDay(
  db: Db,
  organisationId: string,
  input: { day: string; country: string },
): Promise<CalendarDayCampaign[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return [];
  const from = new Date(`${input.day}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 86_400_000);
  const rows = rowsOf(
    await db.execute(sql`
      select pm.campaign_id, c.name as campaign_name, coalesce(u.name, u.email) as account,
        count(*)::int as sent,
        count(*) filter (where pm.clicked)::int as clicks,
        sum(pm.leads)::int as leads,
        sum(pm.sales)::int as sales
      from (${perMessage(organisationId, { from, to, countries: [input.country] })}) pm
      left join campaigns c on c.id = pm.campaign_id
      left join users u on u.id = c.created_by
      group by pm.campaign_id, c.name, u.name, u.email
      order by sent desc, c.name asc nulls last`),
  );
  return rows.map((r) => {
    const sent = num(r.sent);
    const clicks = num(r.clicks);
    return {
      campaignId: text(r.campaign_id),
      campaignName: text(r.campaign_name),
      account: text(r.account),
      sent,
      clicks,
      ctr: sent > 0 ? clicks / sent : 0,
      leads: num(r.leads),
      sales: num(r.sales),
    };
  });
}
