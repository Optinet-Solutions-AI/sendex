import { and, eq, inArray, sql } from "drizzle-orm";
import { campaignLinks, campaigns, laps, links } from "../schema/campaigns.js";
import { routes } from "../schema/routes.js";
import { clicks, messages } from "../schema/tracking.js";
import type { Db } from "../types.js";

/**
 * Everything the links service needs to redirect a short code: the message and its
 * ids, plus the values the link template's placeholders are rendered from.
 * `urlTemplate` is null when the campaign has no active link.
 */
export interface ShortCodeTarget {
  messageId: string;
  organisationId: string;
  campaignId: string;
  lapId: string;
  listId: string;
  routeName: string;
  campaignCountry: string;
  dynamicId: string | null;
  e164: string;
  urlTemplate: string | null;
}

/**
 * Resolve a short code to its message and the campaign's active link. A campaign with
 * several active links yields the oldest one; the message does not record which link
 * its text used (follow-up when multi-link campaigns land).
 */
export async function findShortCodeTarget(db: Db, code: string): Promise<ShortCodeTarget | null> {
  const [row] = await db
    .select({
      messageId: messages.id,
      organisationId: messages.organisationId,
      campaignId: messages.campaignId,
      lapId: messages.lapId,
      listId: laps.listId,
      routeName: routes.name,
      campaignCountry: campaigns.country,
      dynamicId: messages.dynamicId,
      e164: messages.e164,
      urlTemplate: links.url,
    })
    .from(messages)
    .innerJoin(campaigns, eq(campaigns.id, messages.campaignId))
    .innerJoin(laps, eq(laps.id, messages.lapId))
    .innerJoin(routes, eq(routes.id, messages.routeId))
    .leftJoin(
      campaignLinks,
      and(eq(campaignLinks.campaignId, messages.campaignId), eq(campaignLinks.active, true)),
    )
    .leftJoin(links, and(eq(links.id, campaignLinks.linkId), eq(links.active, true)))
    .where(eq(messages.shortCode, code))
    .orderBy(links.createdAt)
    .limit(1);
  return row ?? null;
}

export interface ShortCodeMessage {
  id: string;
  shortCode: string;
  organisationId: string;
  campaignId: string;
  lapId: string;
}

/** The messages behind a batch of short codes; unknown codes are simply absent. */
export async function findMessagesByShortCodes(
  db: Db,
  codes: readonly string[],
): Promise<ShortCodeMessage[]> {
  if (codes.length === 0) return [];
  const rows = await db
    .select({
      id: messages.id,
      shortCode: messages.shortCode,
      organisationId: messages.organisationId,
      campaignId: messages.campaignId,
      lapId: messages.lapId,
    })
    .from(messages)
    .where(inArray(messages.shortCode, [...codes]));
  return rows.flatMap((row) =>
    row.shortCode === null ? [] : [{ ...row, shortCode: row.shortCode }],
  );
}

export interface NewClick {
  organisationId: string;
  messageId: string;
  campaignId: string;
  lapId: string;
  at: Date;
  ip: string | null;
  /** ISO 3166-1 alpha-2 or null. */
  country: string | null;
  userAgent: string | null;
  device: string | null;
  operator: string | null;
}

/**
 * Insert a batch of clicks and add the per-lap counts to `laps.clicks`, in one
 * transaction so the counter never drifts from the rows. Returns the number inserted.
 */
export async function recordClicks(db: Db, rows: readonly NewClick[]): Promise<number> {
  if (rows.length === 0) return 0;
  const perLap = new Map<string, number>();
  for (const row of rows) perLap.set(row.lapId, (perLap.get(row.lapId) ?? 0) + 1);

  await db.transaction(async (tx) => {
    await tx.insert(clicks).values([...rows]);
    for (const [lapId, count] of perLap) {
      await tx
        .update(laps)
        .set({ clicks: sql`${laps.clicks} + ${count}` })
        .where(eq(laps.id, lapId));
    }
  });
  return rows.length;
}
