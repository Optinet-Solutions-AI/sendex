import type { MonthlyCostSales, PivotRow, SendBucket, SeriesPoint } from "@sendex/core";
import { type SQL, sql } from "drizzle-orm";
import type { Db } from "../types.js";

/**
 * The read models of the dashboard tabs (D4-05). Everything is scoped by organisation and
 * by the global filter (a UTC window on the send time and a country list) and read live
 * from the message, click, postback and ledger rows through one "message facts" CTE.
 */

export interface DashboardFilter {
  /** Inclusive, UTC. */
  from?: Date | undefined;
  /** Exclusive, UTC. */
  to?: Date | undefined;
  /** ISO-2 codes; empty or undefined means every country. */
  countries?: readonly string[] | undefined;
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
const date = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

function codes(countries: readonly string[] | undefined): string[] {
  return (countries ?? []).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
}

function inCountries(column: SQL, countries: readonly string[] | undefined): SQL {
  const list = codes(countries);
  if (list.length === 0) return sql``;
  return sql` and ${column} in (${sql.join(
    list.map((c) => sql`${c}`),
    sql`, `,
  )})`;
}

function inWindow(column: SQL, filter: DashboardFilter): SQL {
  const parts: SQL[] = [];
  if (filter.from) parts.push(sql` and ${column} >= ${filter.from.toISOString()}::timestamptz`);
  if (filter.to) parts.push(sql` and ${column} < ${filter.to.toISOString()}::timestamptz`);
  return sql.join(parts, sql``);
}

/**
 * One row per submitted message in the window: its day and month, dimensions, whether a
 * human clicked it, how many bot previews it drew, its leads, sales, revenue (postback value
 * or the offer's profit per sale) and ledger cost.
 */
function messageFacts(organisationId: string, filter: DashboardFilter, onlyApi = false): SQL {
  return sql`
    select m.id, m.contact_id, m.e164, m.sender_id, m.text, m.ad_text_id, m.link_id, m.status,
      m.sent_at,
      (m.sent_at at time zone 'UTC')::date as day,
      to_char(m.sent_at at time zone 'UTC', 'YYYY-MM') as month,
      to_char(date_trunc('week', m.sent_at at time zone 'UTC'), 'YYYY-MM-DD') as week,
      m.campaign_id, c.name as campaign_name, c.source as campaign_source,
      coalesce(li.country, c.country) as country,
      l.list_id, li.name as list_name, m.route_id,
      coalesce(lk.name, '(no link)') as link_name,
      exists (select 1 from clicks ck where ck.message_id = m.id and ck.device is distinct from 'bot') as clicked,
      (select count(*) from clicks ck where ck.message_id = m.id and ck.device = 'bot') as previews,
      (select count(*) from postbacks p where p.message_id = m.id and p.type = 'lead') as leads,
      (select count(*) from postbacks p where p.message_id = m.id and p.type = 'sale') as sales,
      (select coalesce(sum(coalesce(p.value_micro, lk.profit_micro, 0)), 0) from postbacks p
         where p.message_id = m.id and p.type = 'sale') as revenue,
      (select coalesce(-sum(le.amount_micro), 0) from ledger_entries le
         where le.reference_type = 'message' and le.reference_id = m.id::text) as cost
    from messages m
    join laps l on l.id = m.lap_id
    left join lists li on li.id = l.list_id
    left join campaigns c on c.id = m.campaign_id
    left join links lk on lk.id = m.link_id
    where m.organisation_id = ${organisationId}
      and m.status in ('sent', 'delivered', 'expired')${inWindow(sql`m.sent_at`, filter)}${inCountries(sql`coalesce(li.country, c.country)`, filter.countries)}${onlyApi ? sql` and c.source = 'api'` : sql``}`;
}

// ---------------------------------------------------------------------------
// KPI tiles (Getting Started and Overview)
// ---------------------------------------------------------------------------

export interface DashboardKpis {
  /** Contacts on file (added in the window when one is set). */
  contacts: number;
  sent: number;
  clicks: number;
  spendMicro: bigint;
  leads: number;
  sales: number;
  /** Spend over sales, null without sales. */
  blendedCpsMicro: bigint | null;
}

export async function dashboardKpis(
  db: Db,
  organisationId: string,
  filter: DashboardFilter = {},
): Promise<DashboardKpis> {
  const [contactRows, messageRows] = await Promise.all([
    db.execute(sql`
      select count(*)::int as n from contacts ct
      where ct.organisation_id = ${organisationId}${inWindow(sql`ct.created_at`, filter)}${inCountries(sql`ct.country`, filter.countries)}`),
    db.execute(sql`
      select count(*)::int as sent, count(*) filter (where f.clicked)::int as clicks,
        coalesce(sum(f.cost), 0)::bigint as spend, coalesce(sum(f.leads), 0)::int as leads,
        coalesce(sum(f.sales), 0)::int as sales
      from (${messageFacts(organisationId, filter)}) f`),
  ]);
  const c = rowsOf(contactRows)[0];
  const m = rowsOf(messageRows)[0];
  const spendMicro = big(m?.spend);
  const sales = num(m?.sales);
  return {
    contacts: num(c?.n),
    sent: num(m?.sent),
    clicks: num(m?.clicks),
    spendMicro,
    leads: num(m?.leads),
    sales,
    blendedCpsMicro: sales > 0 ? spendMicro / BigInt(sales) : null,
  };
}

// ---------------------------------------------------------------------------
// Overview series
// ---------------------------------------------------------------------------

/** Contacts added per month and country (by the contact's created time). */
export async function contactsUploadedByMonth(
  db: Db,
  organisationId: string,
  filter: DashboardFilter = {},
): Promise<SeriesPoint[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select to_char(ct.created_at at time zone 'UTC', 'YYYY-MM') as period, ct.country as key,
        count(*)::int as value
      from contacts ct
      where ct.organisation_id = ${organisationId}${inWindow(sql`ct.created_at`, filter)}${inCountries(sql`ct.country`, filter.countries)}
      group by 1, 2 order by 1, 2`),
  );
  return rows.map((r) => ({ period: String(r.period), key: String(r.key), value: num(r.value) }));
}

export type SeriesGrain = "month" | "week";

/** Messages sent per month (or ISO week, keyed by its Monday) and country. */
export async function sentByPeriod(
  db: Db,
  organisationId: string,
  filter: DashboardFilter = {},
  grain: SeriesGrain = "month",
  onlyApi = false,
): Promise<SeriesPoint[]> {
  const column = grain === "week" ? sql`f.week` : sql`f.month`;
  const rows = rowsOf(
    await db.execute(sql`
      select ${column} as period, f.country as key, count(*)::int as value
      from (${messageFacts(organisationId, filter, onlyApi)}) f
      group by 1, 2 order by 1, 2`),
  );
  return rows.map((r) => ({ period: String(r.period), key: String(r.key), value: num(r.value) }));
}

// ---------------------------------------------------------------------------
// ROI
// ---------------------------------------------------------------------------

/** The finest grain of the ROI pivot: country × link × list × month. */
export async function roiRows(
  db: Db,
  organisationId: string,
  filter: DashboardFilter = {},
): Promise<PivotRow[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select f.country, f.link_name as link, coalesce(f.list_name, '—') as list, f.month,
        coalesce(sum(f.cost), 0)::bigint as cost,
        count(*) filter (where f.clicked)::int as clicks,
        coalesce(sum(f.leads), 0)::int as leads,
        coalesce(sum(f.sales), 0)::int as sales,
        coalesce(sum(f.revenue), 0)::bigint as revenue
      from (${messageFacts(organisationId, filter)}) f
      group by 1, 2, 3, 4`),
  );
  return rows.map((r) => ({
    country: String(r.country),
    link: String(r.link),
    list: String(r.list),
    month: String(r.month),
    cost: big(r.cost),
    clicks: num(r.clicks),
    leads: num(r.leads),
    sales: num(r.sales),
    revenue: big(r.revenue),
  }));
}

/** Cost and sales per month, account-wide (the cost-per-sale chart ignores the filters). */
export async function costPerSaleByMonth(
  db: Db,
  organisationId: string,
): Promise<MonthlyCostSales[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select f.month, coalesce(sum(f.cost), 0)::bigint as cost, coalesce(sum(f.sales), 0)::int as sales
      from (${messageFacts(organisationId, {})}) f
      group by 1 order by 1`),
  );
  return rows.map((r) => ({ month: String(r.month), cost: big(r.cost), sales: num(r.sales) }));
}

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

export interface CountryBreakdownRow {
  country: string;
  /** Contacts on file in the country, whatever the window. */
  contacts: number;
  sent: number;
  clicks: number;
  leads: number;
  sales: number;
  costMicro: bigint;
  lastSentAt: Date | null;
  /** Distinct contacts that produced a lead / a sale. */
  uniqueSignups: number;
  uniqueBuyers: number;
}

export async function countryBreakdown(
  db: Db,
  organisationId: string,
  filter: DashboardFilter = {},
): Promise<CountryBreakdownRow[]> {
  const rows = rowsOf(
    await db.execute(sql`
      with ct as (
        select country, count(*)::int as contacts from contacts
        where organisation_id = ${organisationId}${inCountries(sql`country`, filter.countries)}
        group by country
      ), f as (${messageFacts(organisationId, filter)}),
      agg as (
        select f.country, count(*)::int as sent, count(*) filter (where f.clicked)::int as clicks,
          coalesce(sum(f.leads), 0)::int as leads, coalesce(sum(f.sales), 0)::int as sales,
          coalesce(sum(f.cost), 0)::bigint as cost, max(f.sent_at) as last_sent_at,
          count(distinct f.contact_id) filter (where f.leads > 0)::int as signups,
          count(distinct f.contact_id) filter (where f.sales > 0)::int as buyers
        from f group by f.country
      )
      select coalesce(ct.country, agg.country) as country, coalesce(ct.contacts, 0) as contacts,
        coalesce(agg.sent, 0) as sent, coalesce(agg.clicks, 0) as clicks, coalesce(agg.leads, 0) as leads,
        coalesce(agg.sales, 0) as sales, coalesce(agg.cost, 0) as cost, agg.last_sent_at,
        coalesce(agg.signups, 0) as signups, coalesce(agg.buyers, 0) as buyers
      from ct full outer join agg on agg.country = ct.country
      order by contacts desc, country`),
  );
  return rows.map((r) => ({
    country: String(r.country),
    contacts: num(r.contacts),
    sent: num(r.sent),
    clicks: num(r.clicks),
    leads: num(r.leads),
    sales: num(r.sales),
    costMicro: big(r.cost),
    lastSentAt: date(r.last_sent_at),
    uniqueSignups: num(r.signups),
    uniqueBuyers: num(r.buyers),
  }));
}

export interface ConversionSeries {
  signups: SeriesPoint[];
  buyers: SeriesPoint[];
}

/**
 * New unique signups and buyers per month and country: a contact counts once, in the month
 * of its first lead (or sale) on a message sent in the window.
 */
export async function conversionsByMonth(
  db: Db,
  organisationId: string,
  filter: DashboardFilter = {},
): Promise<ConversionSeries> {
  const rows = rowsOf(
    await db.execute(sql`
      with f as (${messageFacts(organisationId, filter)}),
      firsts as (
        select p.type, f.contact_id, f.country, min(p.received_at) as first_at
        from postbacks p join f on f.id = p.message_id
        group by p.type, f.contact_id, f.country
      )
      select type, to_char(first_at at time zone 'UTC', 'YYYY-MM') as period, country as key,
        count(*)::int as value
      from firsts group by 1, 2, 3 order by 2, 3`),
  );
  const signups: SeriesPoint[] = [];
  const buyers: SeriesPoint[] = [];
  for (const r of rows) {
    const point = { period: String(r.period), key: String(r.key), value: num(r.value) };
    (r.type === "sale" ? buyers : signups).push(point);
  }
  return { signups, buyers };
}

// ---------------------------------------------------------------------------
// Contacts tab
// ---------------------------------------------------------------------------

export interface TopListRow {
  id: string;
  name: string;
  contacts: number;
}

/** Lists by size, 10 a page, for the Contacts tab card. */
export async function topLists(
  db: Db,
  organisationId: string,
  input: { countries?: readonly string[] | undefined; page: number; pageSize?: number },
): Promise<{ rows: TopListRow[]; total: number }> {
  const pageSize = input.pageSize ?? 10;
  const offset = Math.max(0, input.page - 1) * pageSize;
  const rows = rowsOf(
    await db.execute(sql`
      select id, name, numbers_count as contacts, count(*) over () as total from lists
      where organisation_id = ${organisationId} and archived_at is null${inCountries(sql`country`, input.countries)}
      order by numbers_count desc, name limit ${pageSize} offset ${offset}`),
  );
  return {
    rows: rows.map((r) => ({ id: String(r.id), name: String(r.name), contacts: num(r.contacts) })),
    total: num(rows[0]?.total),
  };
}

export interface SegmentCardRow {
  id: string;
  name: string;
  /** The plain-English rule summary saved with the segment. */
  summary: string;
  /** The creation time of the newest campaign that used it. */
  lastUsedAt: Date | null;
}

/** Segments (audiences, not templates) with when a campaign last used them. */
export async function segmentsCard(db: Db, organisationId: string): Promise<SegmentCardRow[]> {
  const rows = rowsOf(
    await db.execute(sql`
      select s.id, s.name, s.summary,
        (select max(c.created_at) from campaign_segments cs join campaigns c on c.id = cs.campaign_id
          where cs.segment_id = s.id) as last_used_at
      from segments s
      where s.organisation_id = ${organisationId} and s.is_template = false
      order by s.name limit 10`),
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    summary: String(r.summary ?? ""),
    lastUsedAt: date(r.last_used_at),
  }));
}

export interface SendBucketRow {
  bucket: SendBucket;
  country: string;
  /** Good (sendable) contacts in the bucket. */
  contacts: number;
  /** Messages sent to those contacts, and how many were clicked, for the bucket's CTR. */
  sent: number;
  clicks: number;
}

/**
 * Good contacts (in a list, not flagged bad, not unsubscribed) grouped by how many messages
 * they ever received, per country, with the clicks on those messages.
 */
export async function sendCountDistribution(
  db: Db,
  organisationId: string,
  filter: DashboardFilter = {},
): Promise<SendBucketRow[]> {
  const rows = rowsOf(
    await db.execute(sql`
      with good as (
        select ct.id, ct.country from contacts ct
        where ct.organisation_id = ${organisationId}${inCountries(sql`ct.country`, filter.countries)}
          and exists (select 1 from list_members lm where lm.contact_id = ct.id and lm.bad = false)
          and not exists (select 1 from suppressions s where s.organisation_id = ct.organisation_id and s.e164 = ct.e164)
      ), per_contact as (
        select g.id, g.country,
          (select count(*) from messages m where m.contact_id = g.id and m.status in ('sent', 'delivered', 'expired')) as sent,
          (select count(distinct ck.message_id) from clicks ck join messages m on m.id = ck.message_id
             where m.contact_id = g.id and ck.device is distinct from 'bot') as clicks
        from good g
      )
      select case when sent = 0 then '0' when sent <= 2 then '1–2' when sent <= 5 then '3–5'
               when sent <= 10 then '6–10' else '11+' end as bucket,
        country, count(*)::int as contacts, coalesce(sum(sent), 0)::int as sent,
        coalesce(sum(clicks), 0)::int as clicks
      from per_contact group by 1, 2 order by 1, 2`),
  );
  return rows.map((r) => ({
    bucket: String(r.bucket) as SendBucket,
    country: String(r.country),
    contacts: num(r.contacts),
    sent: num(r.sent),
    clicks: num(r.clicks),
  }));
}

export interface UnderSentRow {
  country: string;
  good: number;
  /** Good contacts sent fewer than `threshold` times. */
  under: number;
}

export async function underSentContacts(
  db: Db,
  organisationId: string,
  input: { threshold: number; countries?: readonly string[] | undefined },
): Promise<UnderSentRow[]> {
  const threshold = Math.max(0, Math.floor(input.threshold));
  const rows = rowsOf(
    await db.execute(sql`
      with good as (
        select ct.id, ct.country,
          (select count(*) from messages m where m.contact_id = ct.id and m.status in ('sent', 'delivered', 'expired')) as sent
        from contacts ct
        where ct.organisation_id = ${organisationId}${inCountries(sql`ct.country`, input.countries)}
          and exists (select 1 from list_members lm where lm.contact_id = ct.id and lm.bad = false)
          and not exists (select 1 from suppressions s where s.organisation_id = ct.organisation_id and s.e164 = ct.e164)
      )
      select country, count(*)::int as good, count(*) filter (where sent < ${threshold})::int as under
      from good group by country order by good desc, country`),
  );
  return rows.map((r) => ({ country: String(r.country), good: num(r.good), under: num(r.under) }));
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetKind = "text" | "offer" | "sid";

export interface AssetPerformanceRow {
  key: string;
  label: string;
  /** "SID ES" under a sender id; the URL under an offer. */
  sublabel: string | null;
  sent: number;
  delivered: number;
  clicks: number;
  leads: number;
  sales: number;
  spendMicro: bigint;
  lastSentAt: Date | null;
}

const ASSET_LIMIT = 200;

/** How each SMS text, offer or sender id performed across every campaign, ranked by sent. */
export async function assetPerformance(
  db: Db,
  organisationId: string,
  input: { kind: AssetKind; search?: string | undefined } & DashboardFilter,
): Promise<{ rows: AssetPerformanceRow[]; total: number }> {
  const search = input.search?.trim() ?? "";
  const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const facts = messageFacts(organisationId, input);
  let query: SQL;
  if (input.kind === "text") {
    query = sql`
      select coalesce(f.ad_text_id::text, md5(f.text)) as key, f.text as label, null as sublabel,
        count(*)::int as sent, count(*) filter (where f.status = 'delivered')::int as delivered,
        count(*) filter (where f.clicked)::int as clicks, coalesce(sum(f.leads), 0)::int as leads,
        coalesce(sum(f.sales), 0)::int as sales, coalesce(sum(f.cost), 0)::bigint as spend,
        max(f.sent_at) as last_sent_at, count(*) over () as total
      from (${facts}) f
      where ${search === "" ? sql`true` : sql`f.text ilike ${pattern}`}
      group by 1, 2 order by sent desc, label limit ${ASSET_LIMIT}`;
  } else if (input.kind === "offer") {
    query = sql`
      select coalesce(f.link_id::text, 'none') as key, f.link_name as label, lk.url as sublabel,
        count(*)::int as sent, count(*) filter (where f.status = 'delivered')::int as delivered,
        count(*) filter (where f.clicked)::int as clicks, coalesce(sum(f.leads), 0)::int as leads,
        coalesce(sum(f.sales), 0)::int as sales, coalesce(sum(f.cost), 0)::bigint as spend,
        max(f.sent_at) as last_sent_at, count(*) over () as total
      from (${facts}) f left join links lk on lk.id = f.link_id
      where ${search === "" ? sql`true` : sql`f.link_name ilike ${pattern}`}
      group by 1, 2, 3 order by sent desc, label limit ${ASSET_LIMIT}`;
  } else {
    query = sql`
      select f.sender_id as key, f.sender_id as label,
        (select 'SID ' || sg.country from sender_ids si join sid_groups sg on sg.id = si.sid_group_id
           where si.organisation_id = ${organisationId} and si.value = f.sender_id limit 1) as sublabel,
        count(*)::int as sent, count(*) filter (where f.status = 'delivered')::int as delivered,
        count(*) filter (where f.clicked)::int as clicks, coalesce(sum(f.leads), 0)::int as leads,
        coalesce(sum(f.sales), 0)::int as sales, coalesce(sum(f.cost), 0)::bigint as spend,
        max(f.sent_at) as last_sent_at, count(*) over () as total
      from (${facts}) f
      where ${search === "" ? sql`true` : sql`f.sender_id ilike ${pattern}`}
      group by 1, 2 order by sent desc, label limit ${ASSET_LIMIT}`;
  }
  const rows = rowsOf(await db.execute(query));
  return {
    rows: rows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      sublabel: text(r.sublabel),
      sent: num(r.sent),
      delivered: num(r.delivered),
      clicks: num(r.clicks),
      leads: num(r.leads),
      sales: num(r.sales),
      spendMicro: big(r.spend),
      lastSentAt: date(r.last_sent_at),
    })),
    total: num(rows[0]?.total),
  };
}

// ---------------------------------------------------------------------------
// API usage
// ---------------------------------------------------------------------------

export interface ApiCountryRow {
  country: string;
  sent: number;
  previews: number;
  clicks: number;
  leads: number;
  sales: number;
  spendMicro: bigint;
  lastSentAt: Date | null;
}

export interface ApiLogRow {
  id: string;
  from: string;
  to: string;
  country: string;
  text: string;
  costMicro: bigint;
  status: string;
  sentAt: Date;
}

export interface ApiUsage {
  kpis: { sent: number; previews: number; clicks: number; spendMicro: bigint };
  perCountryByMonth: SeriesPoint[];
  countries: ApiCountryRow[];
  log: ApiLogRow[];
}

/** Everything the API Usage tab shows, over the campaigns created through the public API. */
export async function apiUsage(
  db: Db,
  organisationId: string,
  filter: DashboardFilter = {},
): Promise<ApiUsage> {
  const [countryRows, logRows, series] = await Promise.all([
    db.execute(sql`
      select f.country, count(*)::int as sent, coalesce(sum(f.previews), 0)::int as previews,
        count(*) filter (where f.clicked)::int as clicks, coalesce(sum(f.leads), 0)::int as leads,
        coalesce(sum(f.sales), 0)::int as sales, coalesce(sum(f.cost), 0)::bigint as spend,
        max(f.sent_at) as last_sent_at
      from (${messageFacts(organisationId, filter, true)}) f
      group by f.country order by sent desc, f.country`),
    db.execute(sql`
      select f.id, f.sender_id, f.e164, f.country, f.text, f.cost, f.status, f.sent_at
      from (${messageFacts(organisationId, filter, true)}) f
      order by f.sent_at desc limit 50`),
    sentByPeriod(db, organisationId, filter, "month", true),
  ]);
  const countries = rowsOf(countryRows).map(
    (r): ApiCountryRow => ({
      country: String(r.country),
      sent: num(r.sent),
      previews: num(r.previews),
      clicks: num(r.clicks),
      leads: num(r.leads),
      sales: num(r.sales),
      spendMicro: big(r.spend),
      lastSentAt: date(r.last_sent_at),
    }),
  );
  const kpis = countries.reduce(
    (k, c) => ({
      sent: k.sent + c.sent,
      previews: k.previews + c.previews,
      clicks: k.clicks + c.clicks,
      spendMicro: k.spendMicro + c.spendMicro,
    }),
    { sent: 0, previews: 0, clicks: 0, spendMicro: 0n },
  );
  const log = rowsOf(logRows).map(
    (r): ApiLogRow => ({
      id: String(r.id),
      from: String(r.sender_id),
      to: String(r.e164),
      country: String(r.country),
      text: String(r.text),
      costMicro: big(r.cost),
      status: String(r.status),
      sentAt: date(r.sent_at) ?? new Date(0),
    }),
  );
  return { kpis, perCountryByMonth: series, countries, log };
}
