import { type ConversionRates, conversionRates, type PostbackType } from "@sendex/core";
import { and, asc, desc, eq, gte, ilike, isNotNull, lte, or, sql } from "drizzle-orm";
import { adTexts, campaigns, laps } from "../schema/campaigns.js";
import { routes } from "../schema/routes.js";
import { messages, postbacks } from "../schema/tracking.js";
import type { Db } from "../types.js";

export type PostbackRow = typeof postbacks.$inferSelect;

export interface NewPostback {
  eventKey: string;
  type: PostbackType;
  dynamicId: string;
  /** Micro-EUR; null when the tracker sent no value. */
  valueMicro: number | bigint | null;
  params: Record<string, string>;
  receivedAt?: Date;
}

export interface InsertPostbackResult {
  /** False when an event with this key was already stored; `postback` is then the stored one. */
  inserted: boolean;
  postback: PostbackRow;
}

/** The stored event with this key for the organisation, or null. */
export async function findPostbackByEventKey(
  db: Db,
  organisationId: string,
  eventKey: string,
): Promise<PostbackRow | null> {
  const [row] = await db
    .select()
    .from(postbacks)
    .where(and(eq(postbacks.organisationId, organisationId), eq(postbacks.eventKey, eventKey)))
    .limit(1);
  return row ?? null;
}

/**
 * Store a postback. A second event with the same key (a tracker retry) is not an error:
 * nothing is written and the first row comes back with `inserted: false`.
 */
export async function insertPostback(
  db: Db,
  organisationId: string,
  input: NewPostback,
): Promise<InsertPostbackResult> {
  const [row] = await db
    .insert(postbacks)
    .values({
      organisationId,
      eventKey: input.eventKey,
      type: input.type,
      dynamicId: input.dynamicId,
      valueMicro: input.valueMicro === null ? null : BigInt(input.valueMicro),
      params: input.params,
      ...(input.receivedAt === undefined ? {} : { receivedAt: input.receivedAt }),
    })
    .onConflictDoNothing({ target: postbacks.eventKey })
    .returning();
  if (row) return { inserted: true, postback: row };
  const existing = await findPostbackByEventKey(db, organisationId, input.eventKey);
  if (!existing) {
    throw new Error(`insertPostback: event key ${input.eventKey} belongs to another organisation`);
  }
  return { inserted: false, postback: existing };
}

export interface AttributeResult {
  /** True when this call linked the postback to a message and counted it on the lap. */
  attributed: boolean;
  postback: PostbackRow;
}

/**
 * Match the postback to the message that carried its dynamic id (within the organisation),
 * record message / campaign / lap on it and add it to the lap's `leads` or `sales` (plus
 * `revenue_micro` for a sale value), all in one transaction. Idempotent: a postback that is
 * already attributed is left alone, so the counters never move twice for one event.
 */
export async function attributePostback(db: Db, postback: PostbackRow): Promise<AttributeResult> {
  if (postback.messageId !== null) return { attributed: false, postback };
  return db.transaction(async (tx) => {
    const [message] = await tx
      .select({ id: messages.id, campaignId: messages.campaignId, lapId: messages.lapId })
      .from(messages)
      .where(
        and(
          eq(messages.organisationId, postback.organisationId),
          eq(messages.dynamicId, postback.dynamicId),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (!message) return { attributed: false, postback };

    const [updated] = await tx
      .update(postbacks)
      .set({ messageId: message.id, campaignId: message.campaignId, lapId: message.lapId })
      .where(and(eq(postbacks.id, postback.id), sql`${postbacks.messageId} is null`))
      .returning();
    if (!updated) {
      const [current] = await tx.select().from(postbacks).where(eq(postbacks.id, postback.id));
      return { attributed: false, postback: current ?? postback };
    }

    const value = updated.valueMicro ?? 0n;
    if (message.lapId !== null) {
      await tx
        .update(laps)
        .set(
          updated.type === "lead"
            ? { leads: sql`${laps.leads} + 1` }
            : {
                sales: sql`${laps.sales} + 1`,
                revenueMicro: sql`${laps.revenueMicro} + ${value}`,
              },
        )
        .where(eq(laps.id, message.lapId));
    }
    return { attributed: true, postback: updated };
  });
}

export interface ListPostbacksInput {
  type?: PostbackType | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** Matches the event key or the dynamic id, case-insensitively. */
  search?: string | undefined;
  page: number;
  pageSize: number;
}

export interface PostbackListRow extends PostbackRow {
  campaignName: string | null;
}

export interface PostbackPage {
  rows: PostbackListRow[];
  total: number;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The organisation's postback log, newest first, with the attributed campaign's name. */
export async function listPostbacks(
  db: Db,
  organisationId: string,
  input: ListPostbacksInput,
): Promise<PostbackPage> {
  const conditions = [eq(postbacks.organisationId, organisationId)];
  if (input.type !== undefined) conditions.push(eq(postbacks.type, input.type));
  if (input.from !== undefined) conditions.push(gte(postbacks.receivedAt, input.from));
  if (input.to !== undefined) conditions.push(lte(postbacks.receivedAt, input.to));
  const search = input.search?.trim() ?? "";
  if (search !== "") {
    const pattern = `%${escapeLike(search)}%`;
    const match = or(ilike(postbacks.eventKey, pattern), ilike(postbacks.dynamicId, pattern));
    if (match) conditions.push(match);
  }
  const where = and(...conditions);
  const pageSize = Math.max(1, input.pageSize);
  const offset = Math.max(0, input.page - 1) * pageSize;

  const [rows, [count]] = await Promise.all([
    db
      .select({ postback: postbacks, campaignName: campaigns.name })
      .from(postbacks)
      .leftJoin(campaigns, eq(campaigns.id, postbacks.campaignId))
      .where(where)
      .orderBy(desc(postbacks.receivedAt), desc(postbacks.id))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(postbacks)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r.postback, campaignName: r.campaignName })),
    total: count?.total ?? 0,
  };
}

export interface ConversionRow extends ConversionRates {
  /** Lap id, sender id value, ad text id ("" when the message had none) or campaign id. */
  key: string;
  label: string;
  sent: number;
  leads: number;
  sales: number;
  /** Micro-EUR spent on the messages of this row (laps: the lap cost; groups: allocated per message). */
  costMicro: number;
  /** Micro-EUR of sale value reported for this row. */
  revenueMicro: number;
}

export interface ConversionStats {
  campaign: ConversionRow;
  laps: ConversionRow[];
  senderIds: ConversionRow[];
  adTexts: ConversionRow[];
}

interface Counters {
  key: string;
  label: string;
  sent: number;
  leads: number;
  sales: number;
  costMicro: number;
  revenueMicro: number;
}

function toRow(c: Counters): ConversionRow {
  const costMicro = Math.round(c.costMicro);
  return { ...c, costMicro, ...conversionRates({ ...c, costMicro }) };
}

/**
 * Leads, sales, rates, cost and revenue of a campaign: in total, per lap (from the lap
 * counters), per sender id and per ad text (through `messages`, with the lap's cost
 * allocated evenly over the messages it sent). Null when the campaign is not the organisation's.
 */
export async function conversionStats(
  db: Db,
  organisationId: string,
  campaignId: string,
): Promise<ConversionStats | null> {
  const [campaign] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(and(eq(campaigns.organisationId, organisationId), eq(campaigns.id, campaignId)))
    .limit(1);
  if (!campaign) return null;

  const lapRows = await db
    .select({
      id: laps.id,
      routeName: routes.name,
      sent: laps.sent,
      leads: laps.leads,
      sales: laps.sales,
      costMicro: laps.costMicro,
      revenueMicro: laps.revenueMicro,
    })
    .from(laps)
    .innerJoin(routes, eq(routes.id, laps.routeId))
    .where(eq(laps.campaignId, campaignId))
    .orderBy(asc(laps.createdAt), asc(laps.id));

  const perMessage = db
    .select({
      messageId: postbacks.messageId,
      leads: sql<number>`count(*) filter (where ${postbacks.type} = 'lead')`
        .mapWith(Number)
        .as("pb_leads"),
      sales: sql<number>`count(*) filter (where ${postbacks.type} = 'sale')`
        .mapWith(Number)
        .as("pb_sales"),
      revenueMicro:
        sql<number>`coalesce(sum(${postbacks.valueMicro}) filter (where ${postbacks.type} = 'sale'), 0)`
          .mapWith(Number)
          .as("pb_revenue_micro"),
    })
    .from(postbacks)
    .where(and(eq(postbacks.campaignId, campaignId), isNotNull(postbacks.messageId)))
    .groupBy(postbacks.messageId)
    .as("pb");

  const counted = sql`${messages.status} not in ('queued', 'cancelled')`;
  const aggregates = {
    sent: sql<number>`count(*) filter (where ${counted})`.mapWith(Number),
    leads: sql<number>`coalesce(sum(${perMessage.leads}), 0)`.mapWith(Number),
    sales: sql<number>`coalesce(sum(${perMessage.sales}), 0)`.mapWith(Number),
    revenueMicro: sql<number>`coalesce(sum(${perMessage.revenueMicro}), 0)`.mapWith(Number),
    costMicro:
      sql<number>`coalesce(sum(case when ${counted} and ${laps.sent} > 0 then ${laps.costMicro}::numeric / ${laps.sent} else 0 end), 0)`.mapWith(
        Number,
      ),
  };
  const messageScope = and(
    eq(messages.organisationId, organisationId),
    eq(messages.campaignId, campaignId),
  );

  const [senderRows, textRows] = await Promise.all([
    db
      .select({ senderId: messages.senderId, ...aggregates })
      .from(messages)
      .innerJoin(laps, eq(laps.id, messages.lapId))
      .leftJoin(perMessage, eq(perMessage.messageId, messages.id))
      .where(messageScope)
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
      .where(messageScope)
      .groupBy(messages.adTextId, adTexts.text, adTexts.position)
      .orderBy(asc(adTexts.position), asc(adTexts.text)),
  ]);

  const lapStats = lapRows.map((lap) =>
    toRow({
      key: lap.id,
      label: lap.routeName,
      sent: lap.sent,
      leads: lap.leads,
      sales: lap.sales,
      costMicro: Number(lap.costMicro),
      revenueMicro: Number(lap.revenueMicro),
    }),
  );
  const totals: Counters = {
    key: campaign.id,
    label: campaign.name,
    sent: 0,
    leads: 0,
    sales: 0,
    costMicro: 0,
    revenueMicro: 0,
  };
  for (const lap of lapStats) {
    totals.sent += lap.sent;
    totals.leads += lap.leads;
    totals.sales += lap.sales;
    totals.costMicro += lap.costMicro;
    totals.revenueMicro += lap.revenueMicro;
  }

  return {
    campaign: toRow(totals),
    laps: lapStats,
    senderIds: senderRows.map((r) => toRow({ ...pick(r), key: r.senderId, label: r.senderId })),
    adTexts: textRows.map((r) =>
      toRow({ ...pick(r), key: r.adTextId ?? "", label: r.text ?? "No ad text" }),
    ),
  };
}

type Aggregates = Pick<Counters, "sent" | "leads" | "sales" | "costMicro" | "revenueMicro">;

function pick(r: Aggregates): Aggregates {
  return {
    sent: r.sent,
    leads: r.leads,
    sales: r.sales,
    costMicro: r.costMicro,
    revenueMicro: r.revenueMicro,
  };
}
