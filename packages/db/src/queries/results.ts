import {
  type ResultCounters,
  type ResultRates,
  resultRates,
  sumResultCounters,
} from "@sendex/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { campaigns, laps, links, segments } from "../schema/campaigns.js";
import { lists } from "../schema/lists.js";
import { routes } from "../schema/routes.js";
import { clicks, messages } from "../schema/tracking.js";
import type { Db } from "../types.js";
import { recordAudit } from "./audit.js";
import { type LapSummary, lapPriceSql } from "./campaigns.js";
import { createSendingStore } from "./sending.js";

/**
 * The campaign results page (D3-05): header totals, the ranked lap table with the derived
 * columns, and the Analytics breakdowns. Totals and lap rows come from the lap counters the
 * engine keeps current; the network, per-hour and per-link breakdowns are counted from the
 * `messages` and `clicks` tables, so the two can be reconciled against each other.
 */

export interface ResultTotals extends ResultCounters, ResultRates {
  /** Micro-EUR of sale value reported by postbacks. */
  revenueMicro: bigint;
}

export interface LapResult extends LapSummary, ResultRates {
  /** False once the lap is cancelled (switched off); it can be switched on again until it is done. */
  on: boolean;
}

export interface NetworkRow {
  routeId: string;
  name: string;
  provider: string;
  /** Messages accepted by the carrier (status sent, delivered or expired). */
  sent: number;
  delivered: number;
  /** Delivery failures (status failed or expired). */
  failed: number;
  clicks: number;
  ctr: number;
  deliveryRate: number;
  /** Micro-EUR of the laps that used this route. */
  costMicro: bigint;
}

export interface NetworkBreakdown {
  /**
   * `route`: messages carry no operator, so the breakdown is per route / provider. Reserved
   * for `operator` when delivery receipts start to record the mobile network.
   */
  source: "route";
  rows: NetworkRow[];
}

export interface ClicksPerHour {
  /** Whole hours since the first send. */
  hour: number;
  /** Start of the bucket. */
  at: Date;
  clicks: number;
}

export interface ClicksPerLink {
  /** Null for messages that carried no tracked link. */
  linkId: string | null;
  name: string;
  url: string | null;
  sent: number;
  clicks: number;
  ctr: number;
}

export interface CampaignResults {
  campaignId: string;
  /** Earliest `messages.sent_at`, else the earliest lap start; null before anything went out. */
  firstSentAt: Date | null;
  lastSentAt: Date | null;
  totals: ResultTotals;
  /** Sorted by rank (unranked last), then by creation. */
  laps: LapResult[];
  networks: NetworkBreakdown;
  clicksPerHour: ClicksPerHour[];
  clicksPerLink: ClicksPerLink[];
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  throw new Error(`cannot convert ${String(value)} to bigint`);
}

function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

/** Submitted to the carrier: everything after a successful submit, including a later expiry. */
const SUBMITTED = sql`${messages.status} in ('sent', 'delivered', 'expired')`;
const DELIVERED = sql`${messages.status} = 'delivered'`;
const FAILED = sql`${messages.status} in ('failed', 'expired')`;

async function lapResults(db: Db, campaignId: string): Promise<LapResult[]> {
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
    .orderBy(
      sql`${laps.rank} asc nulls last`,
      asc(laps.createdAt),
      asc(lists.name),
      asc(routes.name),
      asc(laps.id),
    );
  return rows.map((r) => ({
    ...r.lap,
    routeName: r.routeName,
    listName: r.listName,
    segmentName: r.segmentName ?? null,
    priceMicro: r.priceMicro,
    on: r.lap.status !== "cancelled",
    ...resultRates(r.lap),
  }));
}

async function networkBreakdown(db: Db, campaignId: string): Promise<NetworkBreakdown> {
  const clicksByRoute = db
    .select({
      routeId: messages.routeId,
      clicks: sql<number>`count(*)`.mapWith(Number).as("route_clicks"),
    })
    .from(clicks)
    .innerJoin(messages, eq(messages.id, clicks.messageId))
    .where(eq(clicks.campaignId, campaignId))
    .groupBy(messages.routeId)
    .as("route_clicks");
  const costByRoute = db
    .select({
      routeId: laps.routeId,
      costMicro: sql<bigint>`sum(${laps.costMicro})`.as("route_cost_micro"),
    })
    .from(laps)
    .where(eq(laps.campaignId, campaignId))
    .groupBy(laps.routeId)
    .as("route_cost");
  const rows = await db
    .select({
      routeId: messages.routeId,
      name: routes.name,
      provider: routes.provider,
      sent: sql<number>`count(*) filter (where ${SUBMITTED})`.mapWith(Number),
      delivered: sql<number>`count(*) filter (where ${DELIVERED})`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${FAILED})`.mapWith(Number),
      clicks: sql<number>`coalesce(${clicksByRoute.clicks}, 0)`.mapWith(Number),
      costMicro: sql<bigint>`coalesce(${costByRoute.costMicro}, 0)`.mapWith(toBigInt),
      firstSentAt: sql<Date | null>`min(${messages.sentAt})`.mapWith(toNullableDate),
    })
    .from(messages)
    .innerJoin(routes, eq(routes.id, messages.routeId))
    .leftJoin(clicksByRoute, eq(clicksByRoute.routeId, messages.routeId))
    .leftJoin(costByRoute, eq(costByRoute.routeId, messages.routeId))
    .where(eq(messages.campaignId, campaignId))
    .groupBy(
      messages.routeId,
      routes.name,
      routes.provider,
      clicksByRoute.clicks,
      costByRoute.costMicro,
    )
    .orderBy(sql`min(${messages.sentAt}) asc nulls last`, asc(routes.name));
  return {
    source: "route",
    rows: rows.map((r) => ({
      routeId: r.routeId,
      name: r.name,
      provider: r.provider,
      sent: r.sent,
      delivered: r.delivered,
      failed: r.failed,
      clicks: r.clicks,
      ctr: r.sent > 0 ? r.clicks / r.sent : 0,
      deliveryRate: r.sent > 0 ? r.delivered / r.sent : 0,
      costMicro: r.costMicro,
    })),
  };
}

async function clicksPerHourSince(
  db: Db,
  campaignId: string,
  firstSentAt: Date,
): Promise<ClicksPerHour[]> {
  // Grouped by the output alias: Drizzle drops the table qualifier in single-table selects,
  // which would make the select and group-by expressions differ.
  const bucket =
    sql<number>`floor(extract(epoch from (${clicks.at} - ${firstSentAt.toISOString()}::timestamptz)) / 3600)::int`
      .mapWith(Number)
      .as("hour_bucket");
  const rows = await db
    .select({ hour: bucket, clicks: sql<number>`count(*)`.mapWith(Number) })
    .from(clicks)
    .where(eq(clicks.campaignId, campaignId))
    .groupBy(sql`hour_bucket`)
    .orderBy(sql`hour_bucket`);
  return rows.map((r) => ({
    hour: r.hour,
    at: new Date(firstSentAt.getTime() + r.hour * 3_600_000),
    clicks: r.clicks,
  }));
}

async function clicksPerLinkOf(db: Db, campaignId: string): Promise<ClicksPerLink[]> {
  const clicksByLink = db
    .select({
      linkId: messages.linkId,
      clicks: sql<number>`count(*)`.mapWith(Number).as("link_clicks"),
    })
    .from(clicks)
    .innerJoin(messages, eq(messages.id, clicks.messageId))
    .where(eq(clicks.campaignId, campaignId))
    .groupBy(messages.linkId)
    .as("link_clicks");
  const rows = await db
    .select({
      linkId: messages.linkId,
      name: links.name,
      url: links.url,
      sent: sql<number>`count(*) filter (where ${SUBMITTED})`.mapWith(Number),
      clicks: sql<number>`coalesce(max(${clicksByLink.clicks}), 0)`.mapWith(Number),
    })
    .from(messages)
    .leftJoin(links, eq(links.id, messages.linkId))
    .leftJoin(clicksByLink, sql`${clicksByLink.linkId} is not distinct from ${messages.linkId}`)
    .where(eq(messages.campaignId, campaignId))
    .groupBy(messages.linkId, links.name, links.url)
    .orderBy(sql`${links.name} asc nulls last`);
  return rows.map((r) => ({
    linkId: r.linkId,
    name: r.name ?? "No link",
    url: r.url,
    sent: r.sent,
    clicks: r.clicks,
    ctr: r.sent > 0 ? r.clicks / r.sent : 0,
  }));
}

/** Everything the results page shows, or null when the campaign is not the organisation's. */
export async function campaignResults(
  db: Db,
  organisationId: string,
  campaignId: string,
): Promise<CampaignResults | null> {
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.organisationId, organisationId), eq(campaigns.id, campaignId)))
    .limit(1);
  if (!campaign) return null;

  const [lapRows, networks, clicksPerLink, [sendWindow]] = await Promise.all([
    lapResults(db, campaignId),
    networkBreakdown(db, campaignId),
    clicksPerLinkOf(db, campaignId),
    db
      .select({
        first: sql<Date | null>`min(${messages.sentAt})`.mapWith(toNullableDate),
        last: sql<Date | null>`max(${messages.sentAt})`.mapWith(toNullableDate),
      })
      .from(messages)
      .where(eq(messages.campaignId, campaignId)),
  ]);

  const lapStart = lapRows.reduce<Date | null>((earliest, lap) => {
    if (!lap.startedAt) return earliest;
    return earliest && earliest <= lap.startedAt ? earliest : lap.startedAt;
  }, null);
  const firstSentAt = sendWindow?.first ?? lapStart;
  const lastSentAt = sendWindow?.last ?? null;
  const clicksPerHour = firstSentAt ? await clicksPerHourSince(db, campaignId, firstSentAt) : [];

  const counters = sumResultCounters(lapRows);
  const revenueMicro = lapRows.reduce((sum, lap) => sum + lap.revenueMicro, 0n);
  return {
    campaignId,
    firstSentAt,
    lastSentAt,
    totals: { ...counters, revenueMicro, ...resultRates(counters) },
    laps: lapRows,
    networks,
    clicksPerHour,
    clicksPerLink,
  };
}

export interface SetLapOnInput {
  lapId: string;
  on: boolean;
  actorUserId: string | null;
}

/**
 * The per-lap on/off switch of the results page, kept on `laps.status` so the engine honours
 * it without a new column: off cancels a queued or sending lap (its queued messages are
 * cancelled and refunded through the sending store, which also writes `lap.cancel`); on puts
 * a cancelled lap back to `queued` for the dispatcher. A `done` lap cannot be switched. An
 * audit row `lap.toggle` on the campaign records who flipped it.
 */
export async function setLapOn(
  db: Db,
  organisationId: string,
  input: SetLapOnInput,
): Promise<LapSummary> {
  const [current] = await db
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
    .where(and(eq(laps.organisationId, organisationId), eq(laps.id, input.lapId)))
    .limit(1);
  if (!current) throw new Error("Lap not found");
  const from = current.lap.status;
  if (from === "done") throw new Error("A finished lap cannot be switched off or on");

  if (input.on) {
    if (from === "cancelled") {
      await db
        .update(laps)
        .set({ status: "queued", finishedAt: null })
        .where(and(eq(laps.id, input.lapId), eq(laps.status, "cancelled")));
    }
  } else if (from === "queued" || from === "sending") {
    await createSendingStore(db).cancelLap({
      lapId: input.lapId,
      organisationId,
      reason: "switched off on the results page",
    });
  }
  await db.update(laps).set({ active: input.on }).where(eq(laps.id, input.lapId));

  const [updated] = await db.select().from(laps).where(eq(laps.id, input.lapId)).limit(1);
  if (!updated) throw new Error("Lap not found");
  await recordAudit(db, organisationId, {
    actorUserId: input.actorUserId,
    action: "lap.toggle",
    targetType: "campaign",
    targetId: current.lap.campaignId,
    details: { lapId: input.lapId, on: input.on, from, to: updated.status },
  });
  return {
    ...updated,
    routeName: current.routeName,
    listName: current.listName,
    segmentName: current.segmentName ?? null,
    priceMicro: current.priceMicro,
  };
}
