import { type ClickRates, clickRates } from "@sendex/core";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { adTexts, campaigns, laps, links } from "../schema/campaigns.js";
import { routes } from "../schema/routes.js";
import { clicks, messages } from "../schema/tracking.js";
import type { Db } from "../types.js";

/**
 * Clicks, CTR and CPC of a campaign (D2-13): in total, per lap, per sender id, per ad
 * text and per link. The lap rows read the lap counters; the breakdowns go through
 * `messages`, so they refresh as clicks and receipts arrive while the campaign is active.
 *
 * Counting rules (docs/engineering/links-and-clicks.md):
 * - `sent` is messages the carrier accepted (`sent_at` set), whatever happened after.
 * - `clicks` is messages clicked at least once: a recipient opening the link three times
 *   is one click for CTR. `rawClicks` is every redirect served, from the `clicks` table.
 * - cost per breakdown row is the lap cost allocated evenly over the lap's sent messages,
 *   as `conversionStats` does.
 */

export interface ClickRow extends ClickRates {
  /** Lap id, sender id value, ad text id, link id ("" when the message had none) or campaign id. */
  key: string;
  label: string;
  sent: number;
  delivered: number;
  /** Messages clicked at least once. */
  clicks: number;
  /** Every click recorded, duplicates included. */
  rawClicks: number;
  /** Micro-EUR. */
  costMicro: number;
}

export interface ClickStats {
  campaign: ClickRow;
  laps: ClickRow[];
  senderIds: ClickRow[];
  adTexts: ClickRow[];
  links: ClickRow[];
}

interface Counters {
  key: string;
  label: string;
  sent: number;
  delivered: number;
  clicks: number;
  rawClicks: number;
  costMicro: number;
}

function toRow(c: Counters): ClickRow {
  const costMicro = Math.round(c.costMicro);
  return { ...c, costMicro, ...clickRates({ ...c, costMicro }) };
}

/** Null when the campaign is not the organisation's. */
export async function clickStats(
  db: Db,
  organisationId: string,
  campaignId: string,
): Promise<ClickStats | null> {
  const [campaign] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(and(eq(campaigns.organisationId, organisationId), eq(campaigns.id, campaignId)))
    .limit(1);
  if (!campaign) return null;

  const rawPerLap = db
    .select({
      lapId: clicks.lapId,
      rawClicks: sql<number>`count(*)`.mapWith(Number).as("raw_clicks"),
    })
    .from(clicks)
    .where(eq(clicks.campaignId, campaignId))
    .groupBy(clicks.lapId)
    .as("raw_per_lap");

  const lapRows = await db
    .select({
      id: laps.id,
      routeName: routes.name,
      sent: laps.sent,
      delivered: laps.delivered,
      clicks: laps.clicks,
      costMicro: laps.costMicro,
      rawClicks: sql<number>`coalesce(${rawPerLap.rawClicks}, 0)`.mapWith(Number),
    })
    .from(laps)
    .innerJoin(routes, eq(routes.id, laps.routeId))
    .leftJoin(rawPerLap, eq(rawPerLap.lapId, laps.id))
    .where(and(eq(laps.organisationId, organisationId), eq(laps.campaignId, campaignId)))
    .orderBy(asc(laps.createdAt), asc(laps.id));

  const perMessage = db
    .select({
      messageId: clicks.messageId,
      rawClicks: sql<number>`count(*)`.mapWith(Number).as("message_raw_clicks"),
    })
    .from(clicks)
    .where(eq(clicks.campaignId, campaignId))
    .groupBy(clicks.messageId)
    .as("per_message");

  const accepted = isNotNull(messages.sentAt);
  const aggregates = {
    sent: sql<number>`count(*) filter (where ${accepted})`.mapWith(Number),
    delivered: sql<number>`count(*) filter (where ${messages.status} = 'delivered')`.mapWith(
      Number,
    ),
    clicks: sql<number>`count(${perMessage.messageId})`.mapWith(Number),
    rawClicks: sql<number>`coalesce(sum(${perMessage.rawClicks}), 0)`.mapWith(Number),
    costMicro:
      sql<number>`coalesce(sum(case when ${accepted} and ${laps.sent} > 0 then ${laps.costMicro}::numeric / ${laps.sent} else 0 end), 0)`.mapWith(
        Number,
      ),
  };
  const scope = and(
    eq(messages.organisationId, organisationId),
    eq(messages.campaignId, campaignId),
  );

  const [senderRows, textRows, linkRows] = await Promise.all([
    db
      .select({ senderId: messages.senderId, ...aggregates })
      .from(messages)
      .innerJoin(laps, eq(laps.id, messages.lapId))
      .leftJoin(perMessage, eq(perMessage.messageId, messages.id))
      .where(scope)
      .groupBy(messages.senderId)
      .orderBy(asc(messages.senderId)),
    db
      .select({
        adTextId: messages.adTextId,
        text: adTexts.text,
        position: adTexts.position,
        ...aggregates,
      })
      .from(messages)
      .innerJoin(laps, eq(laps.id, messages.lapId))
      .leftJoin(adTexts, eq(adTexts.id, messages.adTextId))
      .leftJoin(perMessage, eq(perMessage.messageId, messages.id))
      .where(scope)
      .groupBy(messages.adTextId, adTexts.text, adTexts.position)
      .orderBy(asc(adTexts.position), asc(adTexts.text)),
    db
      .select({ linkId: messages.linkId, name: links.name, url: links.url, ...aggregates })
      .from(messages)
      .innerJoin(laps, eq(laps.id, messages.lapId))
      .leftJoin(links, eq(links.id, messages.linkId))
      .leftJoin(perMessage, eq(perMessage.messageId, messages.id))
      .where(scope)
      .groupBy(messages.linkId, links.name, links.url)
      .orderBy(asc(links.name), asc(links.url)),
  ]);

  const lapStats = lapRows.map((lap) =>
    toRow({
      key: lap.id,
      label: lap.routeName,
      sent: lap.sent,
      delivered: lap.delivered,
      clicks: lap.clicks,
      rawClicks: lap.rawClicks,
      costMicro: Number(lap.costMicro),
    }),
  );
  const totals: Counters = {
    key: campaign.id,
    label: campaign.name,
    sent: 0,
    delivered: 0,
    clicks: 0,
    rawClicks: 0,
    costMicro: 0,
  };
  for (const lap of lapStats) {
    totals.sent += lap.sent;
    totals.delivered += lap.delivered;
    totals.clicks += lap.clicks;
    totals.rawClicks += lap.rawClicks;
    totals.costMicro += lap.costMicro;
  }

  return {
    campaign: toRow(totals),
    laps: lapStats,
    senderIds: senderRows.map((r) => toRow({ ...pick(r), key: r.senderId, label: r.senderId })),
    adTexts: textRows.map((r) =>
      toRow({ ...pick(r), key: r.adTextId ?? "", label: r.text ?? "No ad text" }),
    ),
    links: linkRows.map((r) =>
      toRow({ ...pick(r), key: r.linkId ?? "", label: r.name ?? "No link" }),
    ),
  };
}

type Aggregates = Pick<Counters, "sent" | "delivered" | "clicks" | "rawClicks" | "costMicro">;

function pick(r: Aggregates): Aggregates {
  return {
    sent: r.sent,
    delivered: r.delivered,
    clicks: r.clicks,
    rawClicks: r.rawClicks,
    costMicro: r.costMicro,
  };
}
