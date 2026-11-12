import {
  analyseSmsText,
  type CampaignSort,
  campaignMessageParts,
  type NewCampaign,
  type PlannedLap,
  planLaps,
  type SendSettings,
  splitAdTexts,
} from "@sendex/core";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import {
  adTexts,
  campaignLinks,
  campaignLists,
  campaignRoutes,
  campaignSegments,
  campaignSidGroup,
  campaigns,
  laps,
  links,
  segments,
  senderIds,
  sidGroups,
} from "../schema/campaigns.js";
import { lists } from "../schema/lists.js";
import { routes } from "../schema/routes.js";
import type { Db } from "../types.js";
import { recordAudit } from "./audit.js";
import { segmentListAvailability } from "./segments.js";

export type CampaignRow = typeof campaigns.$inferSelect;
export type CampaignStatus = CampaignRow["status"];
export type SidGroupRow = typeof sidGroups.$inferSelect;
export type SenderIdRow = typeof senderIds.$inferSelect;
export type AdTextRow = typeof adTexts.$inferSelect;
export type LinkRow = typeof links.$inferSelect;
export type LapRow = typeof laps.$inferSelect;

export const CAMPAIGN_PAGE_SIZE = 25;

/** Drivers return int8 aggregates as string, number or bigint; normalise. */
function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  throw new Error(`cannot convert ${String(value)} to bigint`);
}

function toNullableBigInt(value: unknown): bigint | null {
  return value === null || value === undefined ? null : toBigInt(value);
}

function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

/**
 * Members of a list that can still be messaged: not bad, never sent (or flushed after the last
 * send, which makes them reusable, as the engine's `alreadySent` filter does) and whose number
 * is not suppressed for the organisation. Written with explicit aliases and a literal
 * `lists.id` because Drizzle drops table qualifiers in single-table selects; callers must
 * select from `lists` unaliased.
 */
function availableSql(): SQL<number> {
  return sql<number>`(select count(*) from list_members m
    join contacts c on c.id = m.contact_id
    where m.list_id = lists.id
      and m.bad = false
      and (m.sent_at is null or m.flushed_at > m.sent_at)
      and not exists (select 1 from suppressions s
        where s.organisation_id = m.organisation_id
          and s.e164 = c.e164))::int`.mapWith(Number);
}

async function ownedCampaign(db: Db, organisationId: string, id: string): Promise<CampaignRow> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.organisationId, organisationId), eq(campaigns.id, id)))
    .limit(1);
  if (!row) throw new Error("Campaign not found");
  return row;
}

async function touch(db: Db, campaignId: string): Promise<void> {
  await db.update(campaigns).set({ updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
}

// ---------------------------------------------------------------------------
// Campaign list
// ---------------------------------------------------------------------------

export interface ListCampaignsInput {
  search?: string;
  /** ISO-2 codes; empty or absent means every country. */
  countries?: readonly string[];
  status?: CampaignStatus;
  /** Sending period overlaps [from, to); a campaign without laps is placed at its creation date. */
  from?: Date;
  to?: Date;
  hasLeads?: boolean;
  hasSales?: boolean;
  noClicks?: boolean;
  /** Spend bounds in micro-EUR, both inclusive. */
  spendMinMicro?: bigint;
  spendMaxMicro?: bigint;
  page: number;
  /** Defaults to `CAMPAIGN_PAGE_SIZE`; the CSV export walks larger pages. */
  pageSize?: number;
  /** Sort column; newest first (`created`, `desc`) when absent. */
  sort?: CampaignSort;
  dir?: "asc" | "desc";
}

export interface CampaignSummary {
  id: string;
  name: string;
  country: string;
  timezone: string;
  status: CampaignStatus;
  createdAt: Date;
  lapsCount: number;
  sent: number;
  clicks: number;
  /** Clicks per message sent; 0 when nothing was sent. */
  ctr: number;
  costMicro: bigint;
  leads: number;
  sales: number;
  firstLapAt: Date | null;
  lastLapAt: Date | null;
}

export interface CampaignPage {
  items: CampaignSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Campaigns of the organisation with lap aggregates, newest first unless sorted, paginated. */
export async function listCampaigns(
  db: Db,
  organisationId: string,
  input: ListCampaignsInput,
): Promise<CampaignPage> {
  const conditions = [eq(campaigns.organisationId, organisationId)];
  const search = input.search?.trim();
  if (search) conditions.push(ilike(campaigns.name, `%${search}%`));
  if (input.countries && input.countries.length > 0) {
    conditions.push(
      inArray(
        campaigns.country,
        input.countries.map((c) => c.toUpperCase()),
      ),
    );
  }
  if (input.status) conditions.push(eq(campaigns.status, input.status));

  const agg = db
    .select({
      campaignId: laps.campaignId,
      lapsCount: count().as("laps_count"),
      sent: sql<number>`coalesce(sum(${laps.sent}), 0)`.as("sent"),
      clicks: sql<number>`coalesce(sum(${laps.clicks}), 0)`.as("clicks"),
      costMicro: sql<bigint>`coalesce(sum(${laps.costMicro}), 0)`.as("cost_micro"),
      leads: sql<number>`coalesce(sum(${laps.leads}), 0)`.as("leads"),
      sales: sql<number>`coalesce(sum(${laps.sales}), 0)`.as("sales"),
      firstLapAt: sql<Date | null>`min(coalesce(${laps.startedAt}, ${laps.createdAt}))`.as(
        "first_lap_at",
      ),
      lastLapAt:
        sql<Date | null>`max(coalesce(${laps.finishedAt}, ${laps.startedAt}, ${laps.createdAt}))`.as(
          "last_lap_at",
        ),
    })
    .from(laps)
    .where(eq(laps.organisationId, organisationId))
    .groupBy(laps.campaignId)
    .as("agg");

  // Aggregate-based filters: the lap sums are null for a campaign without laps.
  const clicksSum = sql`coalesce(${agg.clicks}, 0)`;
  const leadsSum = sql`coalesce(${agg.leads}, 0)`;
  const salesSum = sql`coalesce(${agg.sales}, 0)`;
  const costSum = sql`coalesce(${agg.costMicro}, 0)`;
  const periodStart = sql`coalesce(${agg.firstLapAt}, ${campaigns.createdAt})`;
  const periodEnd = sql`coalesce(${agg.lastLapAt}, ${campaigns.createdAt})`;
  if (input.hasLeads) conditions.push(sql`${leadsSum} > 0`);
  if (input.hasSales) conditions.push(sql`${salesSum} > 0`);
  if (input.noClicks) conditions.push(sql`${clicksSum} = 0`);
  if (input.spendMinMicro !== undefined)
    conditions.push(sql`${costSum} >= ${input.spendMinMicro.toString()}::bigint`);
  if (input.spendMaxMicro !== undefined)
    conditions.push(sql`${costSum} <= ${input.spendMaxMicro.toString()}::bigint`);
  // ISO strings, not Date objects: a raw Date in a sql fragment reaches Postgres as Date.toString().
  if (input.from) conditions.push(sql`${periodEnd} >= ${input.from.toISOString()}::timestamptz`);
  if (input.to) conditions.push(sql`${periodStart} < ${input.to.toISOString()}::timestamptz`);
  const filtered = and(...conditions);

  const sentSum = sql`coalesce(${agg.sent}, 0)`;
  const sortExpr: Record<CampaignSort, SQL> = {
    name: sql`lower(${campaigns.name})`,
    status: sql`${campaigns.status}`,
    country: sql`${campaigns.country}`,
    laps: sql`coalesce(${agg.lapsCount}, 0)`,
    sent: sentSum,
    clicks: clicksSum,
    ctr: sql`case when ${sentSum} > 0 then ${clicksSum}::float8 / ${sentSum} else 0 end`,
    cost: costSum,
    leads: leadsSum,
    sales: salesSum,
    period: periodStart,
    created: sql`${campaigns.createdAt}`,
  };
  const sortBy = sortExpr[input.sort ?? "created"];
  const primary = (input.dir ?? "desc") === "asc" ? asc(sortBy) : desc(sortBy);

  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.max(1, Math.floor(input.pageSize ?? CAMPAIGN_PAGE_SIZE));
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      country: campaigns.country,
      timezone: campaigns.timezone,
      status: campaigns.status,
      createdAt: campaigns.createdAt,
      lapsCount: sql<number>`coalesce(${agg.lapsCount}, 0)`.mapWith(Number),
      sent: sql<number>`coalesce(${agg.sent}, 0)`.mapWith(Number),
      clicks: sql<number>`coalesce(${agg.clicks}, 0)`.mapWith(Number),
      costMicro: sql<bigint>`coalesce(${agg.costMicro}, 0)`.mapWith(toBigInt),
      leads: sql<number>`coalesce(${agg.leads}, 0)`.mapWith(Number),
      sales: sql<number>`coalesce(${agg.sales}, 0)`.mapWith(Number),
      firstLapAt: sql<Date | null>`${agg.firstLapAt}`.mapWith(toNullableDate),
      lastLapAt: sql<Date | null>`${agg.lastLapAt}`.mapWith(toNullableDate),
    })
    .from(campaigns)
    .leftJoin(agg, eq(agg.campaignId, campaigns.id))
    .where(filtered)
    .orderBy(primary, desc(campaigns.createdAt), desc(campaigns.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [totalRow] = await db
    .select({ total: count() })
    .from(campaigns)
    .leftJoin(agg, eq(agg.campaignId, campaigns.id))
    .where(filtered);

  return {
    items: rows.map((r) => ({ ...r, ctr: r.sent > 0 ? r.clicks / r.sent : 0 })),
    total: totalRow?.total ?? 0,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Create, detail, duplicate, delete
// ---------------------------------------------------------------------------

export interface CreateCampaignInput extends NewCampaign {
  createdBy?: string | null;
  /** Defaults to the dashboard; the public API passes "api". */
  source?: "dashboard" | "api";
}

export async function createCampaign(
  db: Db,
  organisationId: string,
  input: CreateCampaignInput,
): Promise<CampaignRow> {
  const [row] = await db
    .insert(campaigns)
    .values({
      organisationId,
      name: input.name,
      country: input.country,
      timezone: input.timezone,
      createdBy: input.createdBy ?? null,
      source: input.source ?? "dashboard",
    })
    .returning();
  if (!row) throw new Error("createCampaign: no row returned");
  return row;
}

export interface CampaignListSummary {
  id: string;
  name: string;
  country: string;
  numbersCount: number;
  /** Members that can still be messaged. */
  available: number;
  /** Members messaged since the last flush. */
  sent: number;
  /** Members flagged bad (landline, invalid, carrier rejected). */
  bad: number;
}

function sentSql(): SQL<number> {
  return sql<number>`(select count(*) from list_members m
    where m.list_id = lists.id
      and m.sent_at is not null
      and (m.flushed_at is null or m.flushed_at <= m.sent_at))::int`.mapWith(Number);
}

function badSql(): SQL<number> {
  return sql<number>`(select count(*) from list_members m
    where m.list_id = lists.id and m.bad = true)::int`.mapWith(Number);
}

export interface SidGroupWithIds extends SidGroupRow {
  senderIds: SenderIdRow[];
  activeCount: number;
}

export interface CampaignLinkSummary {
  id: string;
  name: string;
  url: string;
  /** Whether the link is switched on for this campaign. */
  active: boolean;
  /** Revenue per conversion in micro-EUR (Advanced › Profit). */
  profitMicro: bigint;
}

export interface CampaignSegmentSummary {
  id: string;
  name: string;
  summary: string;
  /** The last Refresh Stats, null until run. */
  size: number | null;
  good: number | null;
  /** Matching contacts of the campaign country's lists that can still be sent to. */
  available: number;
}

export interface LapSummary extends LapRow {
  routeName: string;
  listName: string;
  /** The segment the lap was planned from, when it was. */
  segmentName: string | null;
  /** The route's current price for the lap's list country, null when unpriced. */
  priceMicro: bigint | null;
}

export interface CampaignDetail extends CampaignRow {
  lists: CampaignListSummary[];
  segments: CampaignSegmentSummary[];
  sidGroup: SidGroupWithIds | null;
  adTexts: AdTextRow[];
  links: CampaignLinkSummary[];
  laps: LapSummary[];
  /** Routes picked on the send form, in the order they were picked (D4-09). */
  routeIds: string[];
}

async function campaignListsWithAvailable(
  db: Db,
  campaignId: string,
): Promise<CampaignListSummary[]> {
  return db
    .select({
      id: lists.id,
      name: lists.name,
      country: lists.country,
      numbersCount: lists.numbersCount,
      available: availableSql(),
      sent: sentSql(),
      bad: badSql(),
    })
    .from(campaignLists)
    .innerJoin(lists, eq(lists.id, campaignLists.listId))
    .where(eq(campaignLists.campaignId, campaignId))
    .orderBy(asc(lists.name));
}

async function groupWithIds(db: Db, group: SidGroupRow): Promise<SidGroupWithIds> {
  const ids = await db
    .select()
    .from(senderIds)
    .where(eq(senderIds.sidGroupId, group.id))
    .orderBy(asc(senderIds.value));
  return { ...group, senderIds: ids, activeCount: ids.filter((s) => s.active).length };
}

async function campaignSidGroupWithIds(
  db: Db,
  campaignId: string,
): Promise<SidGroupWithIds | null> {
  const [row] = await db
    .select({ group: sidGroups })
    .from(campaignSidGroup)
    .innerJoin(sidGroups, eq(sidGroups.id, campaignSidGroup.sidGroupId))
    .where(eq(campaignSidGroup.campaignId, campaignId))
    .limit(1);
  return row ? groupWithIds(db, row.group) : null;
}

async function campaignLinkSummaries(db: Db, campaignId: string): Promise<CampaignLinkSummary[]> {
  return db
    .select({
      id: links.id,
      name: links.name,
      url: links.url,
      active: campaignLinks.active,
      profitMicro: links.profitMicro,
    })
    .from(campaignLinks)
    .innerJoin(links, eq(links.id, campaignLinks.linkId))
    .where(eq(campaignLinks.campaignId, campaignId))
    .orderBy(asc(links.name));
}

/** The campaign's segments with how many contacts each could still reach in its country. */
async function campaignSegmentsWithAvailable(
  db: Db,
  organisationId: string,
  campaignId: string,
  country: string,
): Promise<CampaignSegmentSummary[]> {
  const rows = await db
    .select({
      id: segments.id,
      name: segments.name,
      summary: segments.summary,
      size: segments.size,
      good: segments.good,
    })
    .from(campaignSegments)
    .innerJoin(segments, eq(segments.id, campaignSegments.segmentId))
    .where(eq(campaignSegments.campaignId, campaignId))
    .orderBy(asc(segments.name));
  const out: CampaignSegmentSummary[] = [];
  for (const row of rows) {
    const perList = await segmentListAvailability(db, organisationId, row.id, country);
    out.push({ ...row, available: perList.reduce((sum, l) => sum + l.available, 0) });
  }
  return out;
}

async function campaignLaps(db: Db, campaignId: string): Promise<LapSummary[]> {
  const rows = await db
    .select({
      lap: laps,
      routeName: routes.name,
      listName: lists.name,
      segmentName: segments.name,
      priceMicro: lapPriceSql(),
    })
    .from(laps)
    .innerJoin(routes, eq(routes.id, laps.routeId))
    .innerJoin(lists, eq(lists.id, laps.listId))
    .leftJoin(segments, eq(segments.id, laps.segmentId))
    .where(eq(laps.campaignId, campaignId))
    .orderBy(asc(laps.createdAt), asc(lists.name), asc(routes.name), asc(laps.id));
  return rows.map((r) => ({
    ...r.lap,
    routeName: r.routeName,
    listName: r.listName,
    segmentName: r.segmentName ?? null,
    priceMicro: r.priceMicro,
  }));
}

/** The route's current price for the lap's list country; for selects joining `laps` and `lists`. */
export function lapPriceSql(): SQL<bigint | null> {
  return sql<bigint | null>`(select rp.price_micro from route_prices rp
    where rp.route_id = laps.route_id
      and rp.country = lists.country
      and rp.valid_from <= now()
    order by rp.valid_from desc limit 1)`.mapWith(toNullableBigInt);
}

/** The campaign with everything the send form shows, or null when it is not the organisation's. */
export async function getCampaign(
  db: Db,
  organisationId: string,
  id: string,
): Promise<CampaignDetail | null> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.organisationId, organisationId), eq(campaigns.id, id)))
    .limit(1);
  if (!campaign) return null;
  const [listRows, segmentRows, sidGroup, textRows, linkRows, lapRows, routeRows] =
    await Promise.all([
      campaignListsWithAvailable(db, id),
      campaignSegmentsWithAvailable(db, organisationId, id, campaign.country),
      campaignSidGroupWithIds(db, id),
      db.select().from(adTexts).where(eq(adTexts.campaignId, id)).orderBy(asc(adTexts.position)),
      campaignLinkSummaries(db, id),
      campaignLaps(db, id),
      db
        .select({ routeId: campaignRoutes.routeId })
        .from(campaignRoutes)
        .where(eq(campaignRoutes.campaignId, id))
        .orderBy(asc(campaignRoutes.position)),
    ]);
  return {
    ...campaign,
    lists: listRows,
    segments: segmentRows,
    sidGroup,
    adTexts: textRows,
    links: linkRows,
    laps: lapRows,
    routeIds: routeRows.map((r) => r.routeId),
  };
}

/**
 * A new draft "Copy of <name>" with the same lists, sender id group, texts, links, routes and
 * settings (routes since D4-09: the team changes what it needs on the copy).
 */
export async function duplicateCampaign(
  db: Db,
  organisationId: string,
  id: string,
  createdBy?: string | null,
): Promise<CampaignRow> {
  const source = await getCampaign(db, organisationId, id);
  if (!source) throw new Error("Campaign not found");
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(campaigns)
      .values({
        organisationId,
        name: `Copy of ${source.name}`,
        country: source.country,
        timezone: source.timezone,
        contactReuse: source.contactReuse,
        testSize: source.testSize,
        createdBy: createdBy ?? null,
      })
      .returning();
    if (!copy) throw new Error("duplicateCampaign: no row returned");
    if (source.lists.length > 0) {
      await tx
        .insert(campaignLists)
        .values(source.lists.map((l) => ({ campaignId: copy.id, listId: l.id, organisationId })));
    }
    if (source.segments.length > 0) {
      await tx.insert(campaignSegments).values(
        source.segments.map((seg) => ({
          campaignId: copy.id,
          segmentId: seg.id,
          organisationId,
        })),
      );
    }
    if (source.sidGroup) {
      await tx
        .insert(campaignSidGroup)
        .values({ campaignId: copy.id, sidGroupId: source.sidGroup.id, organisationId });
    }
    if (source.adTexts.length > 0) {
      await tx.insert(adTexts).values(
        source.adTexts.map((t) => ({
          organisationId,
          campaignId: copy.id,
          text: t.text,
          encoding: t.encoding,
          parts: t.parts,
          active: t.active,
          position: t.position,
        })),
      );
    }
    if (source.routeIds.length > 0) {
      await tx.insert(campaignRoutes).values(
        source.routeIds.map((routeId, position) => ({
          campaignId: copy.id,
          routeId,
          organisationId,
          position,
        })),
      );
    }
    if (source.links.length > 0) {
      await tx.insert(campaignLinks).values(
        source.links.map((l) => ({
          campaignId: copy.id,
          linkId: l.id,
          organisationId,
          active: l.active,
        })),
      );
    }
    return copy;
  });
}

/** Delete a draft. Returns false when the campaign is not the organisation's; throws when not a draft. */
export async function deleteCampaign(db: Db, organisationId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(and(eq(campaigns.organisationId, organisationId), eq(campaigns.id, id)))
    .limit(1);
  if (!row) return false;
  if (row.status !== "draft") throw new Error("Only draft campaigns can be deleted");
  await db.delete(campaigns).where(eq(campaigns.id, id));
  return true;
}

// ---------------------------------------------------------------------------
// Sender id groups
// ---------------------------------------------------------------------------

export async function listSidGroups(
  db: Db,
  organisationId: string,
  country?: string,
): Promise<SidGroupWithIds[]> {
  const conditions = [eq(sidGroups.organisationId, organisationId)];
  if (country) conditions.push(eq(sidGroups.country, country.toUpperCase()));
  const groups = await db
    .select()
    .from(sidGroups)
    .where(and(...conditions))
    .orderBy(asc(sidGroups.name));
  return Promise.all(groups.map((g) => groupWithIds(db, g)));
}

export async function createSidGroup(
  db: Db,
  organisationId: string,
  input: { name: string; country: string },
): Promise<SidGroupRow> {
  const [row] = await db
    .insert(sidGroups)
    .values({ organisationId, name: input.name, country: input.country.toUpperCase() })
    .returning();
  if (!row) throw new Error("createSidGroup: no row returned");
  return row;
}

async function ownedSidGroup(db: Db, organisationId: string, id: string): Promise<SidGroupRow> {
  const [row] = await db
    .select()
    .from(sidGroups)
    .where(and(eq(sidGroups.organisationId, organisationId), eq(sidGroups.id, id)))
    .limit(1);
  if (!row) throw new Error("Sender id group not found");
  return row;
}

/** Add sender ids to a group, skipping values already in it. */
export async function addSenderIds(
  db: Db,
  organisationId: string,
  sidGroupId: string,
  values: readonly string[],
): Promise<{ added: number; rows: SenderIdRow[] }> {
  await ownedSidGroup(db, organisationId, sidGroupId);
  const unique = [...new Set(values)];
  if (unique.length === 0) return { added: 0, rows: [] };
  const rows = await db
    .insert(senderIds)
    .values(unique.map((value) => ({ organisationId, sidGroupId, value })))
    .onConflictDoNothing({ target: [senderIds.sidGroupId, senderIds.value] })
    .returning();
  return { added: rows.length, rows };
}

export async function toggleSenderId(
  db: Db,
  organisationId: string,
  id: string,
  active: boolean,
): Promise<SenderIdRow | null> {
  const [row] = await db
    .update(senderIds)
    .set({ active })
    .where(and(eq(senderIds.organisationId, organisationId), eq(senderIds.id, id)))
    .returning();
  return row ?? null;
}

export async function setCampaignSidGroup(
  db: Db,
  organisationId: string,
  campaignId: string,
  sidGroupId: string,
): Promise<void> {
  await ownedCampaign(db, organisationId, campaignId);
  await ownedSidGroup(db, organisationId, sidGroupId);
  await db
    .insert(campaignSidGroup)
    .values({ campaignId, sidGroupId, organisationId })
    .onConflictDoUpdate({ target: campaignSidGroup.campaignId, set: { sidGroupId } });
  await touch(db, campaignId);
}

// ---------------------------------------------------------------------------
// Ad texts
// ---------------------------------------------------------------------------

/** Add one or several texts (separated by a `//` line), analysed for encoding and parts. */
export async function addAdTexts(
  db: Db,
  organisationId: string,
  campaignId: string,
  input: string,
): Promise<AdTextRow[]> {
  await ownedCampaign(db, organisationId, campaignId);
  const texts = splitAdTexts(input);
  if (texts.length === 0) return [];
  const [max] = await db
    .select({ position: sql<number>`coalesce(max(${adTexts.position}), -1)`.mapWith(Number) })
    .from(adTexts)
    .where(eq(adTexts.campaignId, campaignId));
  const start = (max?.position ?? -1) + 1;
  const rows = await db
    .insert(adTexts)
    .values(
      texts.map((text, i) => {
        const analysis = analyseSmsText(text);
        return {
          organisationId,
          campaignId,
          text,
          encoding: analysis.encoding,
          parts: analysis.parts,
          position: start + i,
        };
      }),
    )
    .returning();
  await touch(db, campaignId);
  return rows;
}

export async function updateAdText(
  db: Db,
  organisationId: string,
  id: string,
  text: string,
): Promise<AdTextRow> {
  const analysis = analyseSmsText(text);
  const [row] = await db
    .update(adTexts)
    .set({ text, encoding: analysis.encoding, parts: analysis.parts })
    .where(and(eq(adTexts.organisationId, organisationId), eq(adTexts.id, id)))
    .returning();
  if (!row) throw new Error("Ad text not found");
  return row;
}

export async function toggleAdText(
  db: Db,
  organisationId: string,
  id: string,
  active: boolean,
): Promise<AdTextRow | null> {
  const [row] = await db
    .update(adTexts)
    .set({ active })
    .where(and(eq(adTexts.organisationId, organisationId), eq(adTexts.id, id)))
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export async function listLinks(db: Db, organisationId: string): Promise<LinkRow[]> {
  return db
    .select()
    .from(links)
    .where(eq(links.organisationId, organisationId))
    .orderBy(asc(links.name));
}

export async function createLink(
  db: Db,
  organisationId: string,
  input: { name: string; url: string; profitMicro?: bigint },
): Promise<LinkRow> {
  const [row] = await db
    .insert(links)
    .values({
      organisationId,
      name: input.name,
      url: input.url,
      profitMicro: input.profitMicro ?? 0n,
    })
    .returning();
  if (!row) throw new Error("createLink: no row returned");
  return row;
}

export async function attachLink(
  db: Db,
  organisationId: string,
  campaignId: string,
  linkId: string,
): Promise<void> {
  await ownedCampaign(db, organisationId, campaignId);
  const [link] = await db
    .select({ id: links.id })
    .from(links)
    .where(and(eq(links.organisationId, organisationId), eq(links.id, linkId)))
    .limit(1);
  if (!link) throw new Error("Link not found");
  await db
    .insert(campaignLinks)
    .values({ campaignId, linkId, organisationId })
    .onConflictDoNothing();
  await touch(db, campaignId);
}

export async function toggleCampaignLink(
  db: Db,
  organisationId: string,
  campaignId: string,
  linkId: string,
  active: boolean,
): Promise<void> {
  await db
    .update(campaignLinks)
    .set({ active })
    .where(
      and(
        eq(campaignLinks.organisationId, organisationId),
        eq(campaignLinks.campaignId, campaignId),
        eq(campaignLinks.linkId, linkId),
      ),
    );
}

export async function detachLink(
  db: Db,
  organisationId: string,
  campaignId: string,
  linkId: string,
): Promise<void> {
  await db
    .delete(campaignLinks)
    .where(
      and(
        eq(campaignLinks.organisationId, organisationId),
        eq(campaignLinks.campaignId, campaignId),
        eq(campaignLinks.linkId, linkId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** The organisation's lists for a country with how many members can still be messaged. */
export async function listsForCountry(
  db: Db,
  organisationId: string,
  country: string,
): Promise<CampaignListSummary[]> {
  return db
    .select({
      id: lists.id,
      name: lists.name,
      country: lists.country,
      numbersCount: lists.numbersCount,
      available: availableSql(),
      sent: sentSql(),
      bad: badSql(),
    })
    .from(lists)
    .where(
      and(
        eq(lists.organisationId, organisationId),
        eq(lists.country, country.toUpperCase()),
        isNull(lists.archivedAt),
      ),
    )
    .orderBy(asc(lists.name));
}

/** Replace the campaign's segments (only the organisation's non-template segments are kept). */
export async function setCampaignSegments(
  db: Db,
  organisationId: string,
  campaignId: string,
  segmentIds: readonly string[],
): Promise<void> {
  await ownedCampaign(db, organisationId, campaignId);
  const owned =
    segmentIds.length === 0
      ? []
      : await db
          .select({ id: segments.id })
          .from(segments)
          .where(
            and(
              eq(segments.organisationId, organisationId),
              eq(segments.isTemplate, false),
              inArray(segments.id, [...segmentIds]),
            ),
          );
  await db.transaction(async (tx) => {
    await tx.delete(campaignSegments).where(eq(campaignSegments.campaignId, campaignId));
    if (owned.length > 0) {
      await tx
        .insert(campaignSegments)
        .values(owned.map((seg) => ({ campaignId, segmentId: seg.id, organisationId })));
    }
  });
  await touch(db, campaignId);
}

/** Replace the campaign's lists with `listIds` (only lists of the organisation are kept). */
export async function setCampaignLists(
  db: Db,
  organisationId: string,
  campaignId: string,
  listIds: readonly string[],
): Promise<void> {
  await ownedCampaign(db, organisationId, campaignId);
  const owned =
    listIds.length === 0
      ? []
      : await db
          .select({ id: lists.id })
          .from(lists)
          .where(and(eq(lists.organisationId, organisationId), inArray(lists.id, [...listIds])));
  await db.transaction(async (tx) => {
    await tx.delete(campaignLists).where(eq(campaignLists.campaignId, campaignId));
    if (owned.length > 0) {
      await tx
        .insert(campaignLists)
        .values(owned.map((l) => ({ campaignId, listId: l.id, organisationId })));
    }
  });
  await touch(db, campaignId);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface RouteOption {
  id: string;
  name: string;
  provider: string;
  /** Shared platform route (no organisation) rather than the organisation's own. */
  platform: boolean;
  /** Current price per SMS part in micro-EUR for the country; null when the route has no price yet. */
  priceMicro: bigint | null;
}

/** Latest price of the outer `routes` row for `country`; same aliasing caveat as `availableSql`. */
function latestPriceSql(country: string): SQL<bigint | null> {
  return sql<bigint | null>`(select rp.price_micro from route_prices rp
    where rp.route_id = routes.id
      and rp.country = ${country}
      and rp.valid_from <= now()
    order by rp.valid_from desc limit 1)`.mapWith(toNullableBigInt);
}

/** Active platform routes priced for `country` plus the organisation's custom routes. */
export async function routesForCountry(
  db: Db,
  organisationId: string,
  country: string,
): Promise<RouteOption[]> {
  const code = country.toUpperCase();
  const price = latestPriceSql(code);
  const rows = await db
    .select({
      id: routes.id,
      name: routes.name,
      provider: routes.provider,
      organisationId: routes.organisationId,
      priceMicro: price,
    })
    .from(routes)
    .where(
      and(
        eq(routes.active, true),
        or(
          and(isNull(routes.organisationId), sql`${price} is not null`),
          eq(routes.organisationId, organisationId),
        ),
      ),
    )
    .orderBy(asc(routes.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    platform: r.organisationId === null,
    priceMicro: r.priceMicro,
  }));
}

/**
 * Save the routes picked on a campaign's send form, in order (D4-09). Only routes the
 * organisation may use for the campaign's country are kept; an empty choice clears it.
 */
export async function setCampaignRoutes(
  db: Db,
  organisationId: string,
  campaignId: string,
  routeIds: readonly string[],
): Promise<void> {
  const campaign = await ownedCampaign(db, organisationId, campaignId);
  const usable = new Set(
    (await routesForCountry(db, organisationId, campaign.country)).map((r) => r.id),
  );
  const kept = [...new Set(routeIds)].filter((id) => usable.has(id));
  await db.transaction(async (tx) => {
    await tx.delete(campaignRoutes).where(eq(campaignRoutes.campaignId, campaignId));
    if (kept.length > 0) {
      await tx
        .insert(campaignRoutes)
        .values(
          kept.map((routeId, position) => ({ campaignId, routeId, organisationId, position })),
        );
    }
  });
  await touch(db, campaignId);
}

// ---------------------------------------------------------------------------
// Send settings, estimate and laps
// ---------------------------------------------------------------------------

/** The persisted part of the send form; `sendAll` is passed per send instead. */
export type SendSettingsInput = Pick<SendSettings, "testSize" | "contactReuse" | "sendNow"> &
  Partial<
    Pick<
      SendSettings,
      | "autosender"
      | "autosenderMeasureMinutes"
      | "autosenderScaleFactor"
      | "autosenderCtrFloorPercent"
    >
  > & {
    scheduledAt?: string;
  };

export async function updateSendSettings(
  db: Db,
  organisationId: string,
  campaignId: string,
  settings: SendSettingsInput,
): Promise<CampaignRow> {
  const [row] = await db
    .update(campaigns)
    .set({
      testSize: settings.testSize,
      contactReuse: settings.contactReuse,
      ...(settings.autosender === undefined ? {} : { autosender: settings.autosender }),
      // Switching AutoSender on (again) clears an earlier automatic stop.
      ...(settings.autosender === true
        ? { autosenderStoppedAt: null, autosenderStopReason: null }
        : {}),
      ...(settings.autosenderMeasureMinutes === undefined
        ? {}
        : { autosenderMeasureMinutes: settings.autosenderMeasureMinutes }),
      ...(settings.autosenderScaleFactor === undefined
        ? {}
        : { autosenderScaleFactor: settings.autosenderScaleFactor }),
      ...(settings.autosenderCtrFloorPercent === undefined
        ? {}
        : { autosenderCtrFloorPercent: settings.autosenderCtrFloorPercent }),
      scheduledAt:
        !settings.sendNow && settings.scheduledAt ? new Date(settings.scheduledAt) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(campaigns.organisationId, organisationId), eq(campaigns.id, campaignId)))
    .returning();
  if (!row) throw new Error("Campaign not found");
  return row;
}

export interface SendOptions {
  /** Routes picked in the send form, in display order. Unknown or unpriced routes are ignored. */
  routeIds: readonly string[];
  /** Send every available contact instead of `testSize` per lap. */
  sendAll: boolean;
  /** Characters `{{domain}}` becomes when sent (`shortLinkLength`). Default 50. */
  linkLength?: number;
}

export interface SendEstimate {
  /** Contacts that can still be messaged across the campaign's lists. */
  contacts: number;
  /** Active sender ids in the campaign's group. */
  sids: number;
  /** Active ad texts. */
  texts: number;
  /** Active attached links. */
  links: number;
  testSize: number;
  sendAll: boolean;
  /** Messages the laps will send. */
  smsCount: number;
  costMicro: bigint;
  lists: CampaignListSummary[];
  segments: CampaignSegmentSummary[];
  routes: RouteOption[];
  laps: PlannedLap[];
}

/** What pressing Send would queue: counts for the footer and the planned laps. */
export async function estimateSend(
  db: Db,
  organisationId: string,
  campaignId: string,
  options: SendOptions,
): Promise<SendEstimate> {
  const campaign = await getCampaign(db, organisationId, campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const available = await routesForCountry(db, organisationId, campaign.country);
  const byId = new Map(available.map((r) => [r.id, r]));
  const chosen: Array<RouteOption & { priceMicro: bigint }> = [];
  for (const id of options.routeIds) {
    const route = byId.get(id);
    if (route && route.priceMicro !== null && !chosen.some((c) => c.id === id)) {
      chosen.push({ ...route, priceMicro: route.priceMicro });
    }
  }

  // A segment audience is one lap per list its contacts live in, filtered by the segment.
  const planLists: Array<{ listId: string; available: number; segmentId?: string }> =
    campaign.lists.map((l) => ({ listId: l.id, available: l.available }));
  for (const seg of campaign.segments) {
    const perList = await segmentListAvailability(db, organisationId, seg.id, campaign.country);
    for (const entry of perList) {
      planLists.push({ listId: entry.listId, available: entry.available, segmentId: seg.id });
    }
  }
  const planned = planLaps({
    testSize: campaign.testSize,
    lists: planLists,
    routes: chosen.map((r) => ({ routeId: r.id, priceMicro: Number(r.priceMicro) })),
    sendAll: options.sendAll,
    partsPerMessage: campaignMessageParts(campaign, options.linkLength),
  });

  return {
    contacts:
      campaign.lists.reduce((sum, l) => sum + l.available, 0) +
      campaign.segments.reduce((sum, seg) => sum + seg.available, 0),
    sids: campaign.sidGroup?.activeCount ?? 0,
    texts: campaign.adTexts.filter((t) => t.active).length,
    links: campaign.links.filter((l) => l.active).length,
    testSize: campaign.testSize,
    sendAll: options.sendAll,
    smsCount: planned.reduce((sum, lap) => sum + lap.count, 0),
    costMicro: planned.reduce((sum, lap) => sum + BigInt(lap.costMicro), 0n),
    lists: campaign.lists,
    segments: campaign.segments,
    routes: chosen,
    laps: planned,
  };
}

export interface CreateLapsInput extends SendOptions {
  actorUserId?: string | null;
}

/**
 * Queue the planned laps. Each lap row is one (list, route) pair in status `queued` with
 * `test_size` set to the number of contacts it must send; the sending engine (D2-04) picks
 * queued laps up, moves them to `sending` and fills in the counters. The campaign becomes
 * `scheduled` when a start time is set in the future and `sending` otherwise, and an
 * audit row `campaign.send` records what was queued.
 */
export async function createLaps(
  db: Db,
  organisationId: string,
  campaignId: string,
  input: CreateLapsInput,
): Promise<LapRow[]> {
  const estimate = await estimateSend(db, organisationId, campaignId, input);
  if (estimate.lists.length === 0 && estimate.segments.length === 0) {
    throw new Error("Pick at least one list or segment");
  }
  if (estimate.routes.length === 0) throw new Error("Pick at least one route");
  if (estimate.texts === 0) throw new Error("Add at least one active ad text");
  if (estimate.sids === 0) throw new Error("Pick a sender id group with an active sender id");
  if (estimate.laps.length === 0)
    throw new Error("Nothing to send: the lists have no contacts left");

  const campaign = await ownedCampaign(db, organisationId, campaignId);
  const scheduled = campaign.scheduledAt !== null && campaign.scheduledAt.getTime() > Date.now();

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(laps)
      .values(
        estimate.laps.map((lap) => ({
          organisationId,
          campaignId,
          listId: lap.listId,
          routeId: lap.routeId,
          testSize: lap.count,
          status: "queued" as const,
          segmentId: lap.segmentId ?? null,
        })),
      )
      .returning();
    await tx
      .update(campaigns)
      .set({ status: scheduled ? "scheduled" : "sending", updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    await recordAudit(tx, organisationId, {
      actorUserId: input.actorUserId ?? null,
      action: "campaign.send",
      targetType: "campaign",
      targetId: campaignId,
      details: {
        lapIds: rows.map((r) => r.id),
        routeIds: estimate.routes.map((r) => r.id),
        listIds: estimate.lists.map((l) => l.id),
        segmentIds: estimate.segments.map((seg) => seg.id),
        sendAll: input.sendAll,
        testSize: estimate.testSize,
        smsCount: estimate.smsCount,
        costMicro: estimate.costMicro.toString(),
        scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
      },
    });
    return rows;
  });
}

// ---------------------------------------------------------------------------
// Sender id group performance (D4-02)
// ---------------------------------------------------------------------------

export interface SidGroupStats {
  groupId: string;
  /** Messages the carriers accepted with a sender id of the group, across every campaign. */
  sent: number;
  clicks: number;
}

/**
 * "14,000 sent · 1.26% CTR" per group in the SIDs tab: messages are matched to a group by
 * the sender id value they carried, within the organisation. Clicks are counted once per
 * message.
 */
export async function sidGroupStats(
  db: Db,
  organisationId: string,
  groupIds: readonly string[],
): Promise<SidGroupStats[]> {
  if (groupIds.length === 0) return [];
  const members = sql`(select s.value from sender_ids s where s.sid_group_id = ${sidGroups.id})`;
  const rows = await db
    .select({
      groupId: sidGroups.id,
      sent: sql<number>`(select count(*) from messages m
        where m.organisation_id = ${organisationId}
          and m.status in ('sent', 'delivered', 'expired')
          and m.sender_id in ${members})::int`.mapWith(Number),
      clicks: sql<number>`(select count(distinct c.message_id) from clicks c
        join messages m on m.id = c.message_id
        where m.organisation_id = ${organisationId}
          and m.sender_id in ${members})::int`.mapWith(Number),
    })
    .from(sidGroups)
    .where(and(eq(sidGroups.organisationId, organisationId), inArray(sidGroups.id, [...groupIds])));
  return rows;
}
