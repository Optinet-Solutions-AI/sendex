import { and, desc, eq, sql } from "drizzle-orm";
import { laps } from "../schema/campaigns.js";
import { routes } from "../schema/routes.js";
import { clicks, messages } from "../schema/tracking.js";
import type { Db } from "../types.js";

/** One row of the campaign's Logs › Messages tab. The recipient is masked. */
export interface CampaignMessageRow {
  id: string;
  sentAt: Date | null;
  createdAt: Date;
  lapId: string;
  routeName: string;
  senderId: string;
  /** `+3460000****`: the number with its last four digits hidden, as SMS Edge shows it. */
  recipient: string;
  text: string;
  status: string;
  errorCode: string | null;
  clicked: boolean;
}

export interface CampaignMessagesPage {
  rows: CampaignMessageRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Hide the last four digits of an E.164 number. */
export function maskRecipient(e164: string): string {
  if (e164.length <= 4) return "****";
  return `${e164.slice(0, -4)}****`;
}

/** Messages of a campaign, newest first, 25 per page by default; scoped by organisation. */
export async function listCampaignMessages(
  db: Db,
  organisationId: string,
  campaignId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<CampaignMessagesPage> {
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const page = Math.max(1, options.page ?? 1);
  const where = and(
    eq(messages.organisationId, organisationId),
    eq(messages.campaignId, campaignId),
  );
  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(where);
  const rows = await db
    .select({
      id: messages.id,
      sentAt: messages.sentAt,
      createdAt: messages.createdAt,
      lapId: messages.lapId,
      routeName: routes.name,
      senderId: messages.senderId,
      e164: messages.e164,
      text: messages.text,
      status: messages.status,
      errorCode: messages.errorCode,
      clicked: sql<boolean>`exists (select 1 from ${clicks} c where c.message_id = ${messages.id})`,
    })
    .from(messages)
    .innerJoin(laps, eq(laps.id, messages.lapId))
    .innerJoin(routes, eq(routes.id, messages.routeId))
    .where(where)
    .orderBy(desc(messages.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      sentAt: r.sentAt,
      createdAt: r.createdAt,
      lapId: r.lapId,
      routeName: r.routeName,
      senderId: r.senderId,
      recipient: maskRecipient(r.e164),
      text: r.text,
      status: r.status,
      errorCode: r.errorCode,
      clicked: Boolean(r.clicked),
    })),
    total: countRow?.n ?? 0,
    page,
    pageSize,
  };
}
