import { and, asc, desc, eq, sql } from "drizzle-orm";
import { campaigns, laps } from "../schema/campaigns.js";
import { listMembers } from "../schema/lists.js";
import type { Db } from "../types.js";

/**
 * The list details page (D4-03): KPI tiles, the Analytics tab (members grouped by country
 * and the device that clicked), the Campaigns tab and the Lookup tab's country breakdown.
 * Sent and clicks come from the laps that drew on the list; leads, sales, cost and revenue
 * from the messages those laps sent. Every read is scoped by organisation.
 */

const toNumber = (v: unknown): number => Number(v ?? 0);
const toBigInt = (v: unknown): bigint => BigInt(String(v ?? 0));

/** `db.execute` returns a row list on postgres-js and `{ rows }` on PGlite. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybe = result as { rows?: Record<string, unknown>[] };
  return maybe.rows ?? [];
}

export interface ListKpis {
  total: number;
  /** Members not flagged bad. */
  good: number;
  bad: number;
  /** Numbers with a cached lookup result; always 0 until a lookup provider exists. */
  cached: number;
  sent: number;
  clicks: number;
  ctr: number;
}

export async function listKpis(db: Db, organisationId: string, listId: string): Promise<ListKpis> {
  const [members] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(toNumber),
      bad: sql<number>`count(*) filter (where ${listMembers.bad})`.mapWith(toNumber),
    })
    .from(listMembers)
    .where(and(eq(listMembers.listId, listId), eq(listMembers.organisationId, organisationId)));
  const [sends] = await db
    .select({
      sent: sql<number>`coalesce(sum(${laps.sent}), 0)`.mapWith(toNumber),
      clicks: sql<number>`coalesce(sum(${laps.clicks}), 0)`.mapWith(toNumber),
    })
    .from(laps)
    .where(and(eq(laps.listId, listId), eq(laps.organisationId, organisationId)));
  const total = members?.total ?? 0;
  const bad = members?.bad ?? 0;
  const sent = sends?.sent ?? 0;
  const clicks = sends?.clicks ?? 0;
  return {
    total,
    good: total - bad,
    bad,
    cached: 0,
    sent,
    clicks,
    ctr: sent > 0 ? clicks / sent : 0,
  };
}

export const ANALYTICS_DIMENSIONS = ["country", "device"] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

export interface ListAnalyticsRow {
  /** One value per requested dimension, in order ("ES", "mobile"); "unknown" when unset. */
  keys: string[];
  audience: number;
  sent: number;
  clicks: number;
  ctr: number;
  leads: number;
  sales: number;
  costMicro: bigint;
  revenueMicro: bigint;
}

/**
 * Members of the list grouped by the chosen dimensions. Device is the device of the
 * contact's first recorded click on a message of this list; contacts never clicked are
 * "unknown". With no dimension, one row for the whole list.
 */
export async function listAnalytics(
  db: Db,
  organisationId: string,
  listId: string,
  dimensions: readonly AnalyticsDimension[],
): Promise<ListAnalyticsRow[]> {
  const dims = [...new Set(dimensions)];
  const groupCols = dims.map((d) => (d === "country" ? "pc.country" : "pc.device"));
  const selectDims = groupCols.length > 0 ? `${groupCols.join(", ")},` : "";
  const groupBy = groupCols.length > 0 ? `group by ${groupCols.join(", ")}` : "";
  const query = sql.raw(`
    with members as (
      select m.contact_id, c.country
      from list_members m
      join contacts c on c.id = m.contact_id
      where m.list_id = '${listId}' and m.organisation_id = '${organisationId}'
    ),
    msgs as (
      select ms.id, ms.contact_id
      from messages ms
      join laps l on l.id = ms.lap_id
      where l.list_id = '${listId}' and ms.organisation_id = '${organisationId}'
        and ms.sent_at is not null
    ),
    dev as (
      select ms.contact_id, min(coalesce(ck.device, 'unknown')) as device
      from clicks ck join msgs ms on ms.id = ck.message_id
      group by ms.contact_id
    ),
    per_contact as (
      select mem.contact_id, mem.country, coalesce(dev.device, 'unknown') as device,
        (select count(*) from msgs where msgs.contact_id = mem.contact_id) as sent,
        (select count(distinct ck.message_id) from clicks ck join msgs on msgs.id = ck.message_id
          where msgs.contact_id = mem.contact_id) as clicks,
        (select count(*) from postbacks p join msgs on msgs.id = p.message_id
          where msgs.contact_id = mem.contact_id and p.type = 'lead') as leads,
        (select count(distinct p.message_id) from postbacks p join msgs on msgs.id = p.message_id
          where msgs.contact_id = mem.contact_id and p.type = 'sale') as sales,
        (select coalesce(sum(p.value_micro), 0) from postbacks p join msgs on msgs.id = p.message_id
          where msgs.contact_id = mem.contact_id and p.type = 'sale') as revenue_micro,
        (select coalesce(-sum(le.amount_micro), 0) from ledger_entries le
          join msgs on le.reference_id = msgs.id::text
          where le.reference_type = 'message' and msgs.contact_id = mem.contact_id) as cost_micro
      from members mem
      left join dev on dev.contact_id = mem.contact_id
    )
    select ${selectDims}
      count(*) as audience,
      coalesce(sum(pc.sent), 0) as sent,
      coalesce(sum(pc.clicks), 0) as clicks,
      coalesce(sum(pc.leads), 0) as leads,
      coalesce(sum(pc.sales), 0) as sales,
      coalesce(sum(pc.cost_micro), 0) as cost_micro,
      coalesce(sum(pc.revenue_micro), 0) as revenue_micro
    from per_contact pc
    ${groupBy}
    order by audience desc
  `);
  assertUuid(listId);
  assertUuid(organisationId);
  const rows = rowsOf(await db.execute(query));
  return rows.map((r) => {
    const sent = toNumber(r.sent);
    const clicks = toNumber(r.clicks);
    return {
      keys: dims.map((d) => String(r[d] ?? "unknown")),
      audience: toNumber(r.audience),
      sent,
      clicks,
      ctr: sent > 0 ? clicks / sent : 0,
      leads: toNumber(r.leads),
      sales: toNumber(r.sales),
      costMicro: toBigInt(r.cost_micro),
      revenueMicro: toBigInt(r.revenue_micro),
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The raw queries interpolate ids as literals; refuse anything that is not a uuid. */
function assertUuid(value: string): void {
  if (!UUID.test(value)) throw new Error("expected a uuid");
}

export interface ListCampaignRow {
  id: string;
  name: string;
  status: string;
  laps: number;
  sent: number;
  clicks: number;
  ctr: number;
  costMicro: bigint;
  firstLapAt: Date | null;
  lastLapAt: Date | null;
}

/** Campaigns that sent (or queued a send) to the list, newest first. */
export async function listCampaignsForList(
  db: Db,
  organisationId: string,
  listId: string,
): Promise<ListCampaignRow[]> {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      laps: sql<number>`count(*)`.mapWith(toNumber),
      sent: sql<number>`coalesce(sum(${laps.sent}), 0)`.mapWith(toNumber),
      clicks: sql<number>`coalesce(sum(${laps.clicks}), 0)`.mapWith(toNumber),
      costMicro: sql<bigint>`coalesce(sum(${laps.costMicro}), 0)::bigint`.mapWith(toBigInt),
      firstLapAt: sql<Date | null>`min(coalesce(${laps.startedAt}, ${laps.createdAt}))`,
      lastLapAt: sql<Date | null>`max(coalesce(${laps.finishedAt}, ${laps.startedAt}, ${laps.createdAt}))`,
    })
    .from(laps)
    .innerJoin(campaigns, eq(campaigns.id, laps.campaignId))
    .where(and(eq(laps.listId, listId), eq(laps.organisationId, organisationId)))
    .groupBy(campaigns.id, campaigns.name, campaigns.status, campaigns.createdAt)
    .orderBy(desc(campaigns.createdAt), asc(campaigns.id));
  return rows.map((r) => ({
    ...r,
    ctr: r.sent > 0 ? r.clicks / r.sent : 0,
    firstLapAt: r.firstLapAt ? new Date(r.firstLapAt) : null,
    lastLapAt: r.lastLapAt ? new Date(r.lastLapAt) : null,
  }));
}

export interface LookupCountryRow {
  country: string;
  total: number;
  good: number;
  bad: number;
  /** Members on the organisation's unsubscribe list. */
  blacklisted: number;
  /** Members with at least one click on a message of this list. */
  clickers: number;
  /** Members sent to since the last flush. */
  sent: number;
  clicks: number;
  ctr: number;
  /** HLR, MNP, local-only, checking and cached need a lookup provider; always 0 for now. */
  hlr: number;
  mnp: number;
  unresolved: number;
  localOnly: number;
  checking: number;
  cached: number;
}

/** The Lookup tab's Country Breakdown: one row per contact country of the list. */
export async function listLookupBreakdown(
  db: Db,
  organisationId: string,
  listId: string,
): Promise<LookupCountryRow[]> {
  assertUuid(listId);
  assertUuid(organisationId);
  const rows = rowsOf(
    await db.execute(
      sql.raw(`
    with msgs as (
      select ms.id, ms.contact_id
      from messages ms join laps l on l.id = ms.lap_id
      where l.list_id = '${listId}' and ms.organisation_id = '${organisationId}'
    )
    select c.country,
      count(*) as total,
      count(*) filter (where not m.bad) as good,
      count(*) filter (where m.bad) as bad,
      count(*) filter (where exists (select 1 from suppressions s
        where s.organisation_id = m.organisation_id and s.e164 = c.e164)) as blacklisted,
      count(*) filter (where exists (select 1 from clicks ck join msgs on msgs.id = ck.message_id
        where msgs.contact_id = m.contact_id)) as clickers,
      count(*) filter (where m.sent_at is not null) as sent,
      (select count(distinct ck.message_id) from clicks ck join msgs on msgs.id = ck.message_id
        join contacts c2 on c2.id = msgs.contact_id where c2.country = c.country) as clicks
    from list_members m
    join contacts c on c.id = m.contact_id
    where m.list_id = '${listId}' and m.organisation_id = '${organisationId}'
    group by c.country
    order by total desc, c.country asc
  `),
    ),
  );
  return rows.map((r) => {
    const sent = toNumber(r.sent);
    const clicks = toNumber(r.clicks);
    const total = toNumber(r.total);
    const bad = toNumber(r.bad);
    return {
      country: String(r.country),
      total,
      good: toNumber(r.good),
      bad,
      blacklisted: toNumber(r.blacklisted),
      clickers: toNumber(r.clickers),
      sent,
      clicks,
      ctr: sent > 0 ? clicks / sent : 0,
      hlr: 0,
      mnp: 0,
      unresolved: total - bad,
      localOnly: 0,
      checking: 0,
      cached: 0,
    };
  });
}
