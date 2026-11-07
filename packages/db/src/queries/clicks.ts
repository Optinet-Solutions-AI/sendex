import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
  // The joins guarantee a campaign and a lap; the columns are nullable only for test sends.
  if (!row || row.campaignId === null || row.lapId === null) return null;
  return { ...row, campaignId: row.campaignId, lapId: row.lapId };
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
    row.shortCode === null || row.campaignId === null || row.lapId === null
      ? []
      : [{ ...row, shortCode: row.shortCode, campaignId: row.campaignId, lapId: row.lapId }],
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
 * Insert a batch of clicks and refresh `laps.clicks` for the laps touched, in one
 * transaction so the counter never drifts from the rows. Every redirect is kept as a row;
 * the counter is the number of distinct messages clicked (a recipient opening the link
 * three times is one click for CTR), recomputed from the rows so a retried batch cannot
 * inflate it. Returns the number of rows inserted.
 */
export async function recordClicks(db: Db, rows: readonly NewClick[]): Promise<number> {
  if (rows.length === 0) return 0;
  const previews = new Map<string, number>();
  const human: NewClick[] = [];
  for (const row of rows) {
    if (row.device === "bot") previews.set(row.lapId, (previews.get(row.lapId) ?? 0) + 1);
    else human.push(row);
  }
  const lapIds = [...new Set(human.map((row) => row.lapId))];

  await db.transaction(async (tx) => {
    if (human.length > 0) {
      await tx.insert(clicks).values(human);
      // The first click that resolved an operator names the message's network (Mobile Networks).
      for (const row of human) {
        if (row.operator) {
          await tx
            .update(messages)
            .set({ operator: row.operator })
            .where(and(eq(messages.id, row.messageId), isNull(messages.operator)));
        }
      }
      await tx
        .update(laps)
        .set({
          clicks: sql`(select count(distinct ${clicks.messageId}) from ${clicks} where ${clicks.lapId} = ${laps.id})`,
        })
        .where(inArray(laps.id, lapIds));
    }
    for (const [lapId, n] of previews) {
      await tx
        .update(laps)
        .set({ previews: sql`${laps.previews} + ${n}` })
        .where(eq(laps.id, lapId));
    }
  });
  return human.length;
}
