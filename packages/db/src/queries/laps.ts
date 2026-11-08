import { campaignMessageParts, topUpPlan } from "@sendex/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { laps } from "../schema/campaigns.js";
import { lists } from "../schema/lists.js";
import type { Db } from "../types.js";
import { recordAudit } from "./audit.js";
import { getCampaign, lapPriceSql } from "./campaigns.js";
import { getBalanceMicro } from "./ledger.js";
import { flushList } from "./lists.js";
import { setLapOn } from "./results.js";

/**
 * The laps header and lap menu of the campaign page: budget top-ups, comments, rescheduling,
 * flushing a lap's list and the All switch. Every helper is scoped by organisation and
 * writes its audit row.
 */

export interface TopUpInput {
  campaignId: string;
  amountMicro: number;
  actorUserId: string | null;
  /** Characters `{{domain}}` becomes when sent (`shortLinkLength`). Default 50. */
  linkLength?: number;
}

export interface TopUpResult {
  /** Laps that received the top-up. */
  laps: number;
  totalMicro: number;
  newSms: number;
}

type LapRow = typeof laps.$inferSelect;

async function lapOf(db: Db, organisationId: string, lapId: string): Promise<LapRow> {
  const [lap] = await db
    .select()
    .from(laps)
    .where(and(eq(laps.organisationId, organisationId), eq(laps.id, lapId)))
    .limit(1);
  if (!lap) throw new Error("Lap not found");
  return lap;
}
/**
 * Add `amountMicro` to the budget of every active lap of the campaign (queued, sending or
 * done; not switched off). Each lap's test size grows by amount / (price × parts per message,
 * see `campaignMessageParts`) so the send loop
 * sends that many more messages; a finished lap goes back to queued. Refused when the
 * organisation's balance cannot cover amount × laps (rule 6: debits stay per message).
 */
export async function topUpLaps(
  db: Db,
  organisationId: string,
  input: TopUpInput,
): Promise<TopUpResult> {
  const rows = await db
    .select({ id: laps.id, status: laps.status, active: laps.active, priceMicro: lapPriceSql() })
    .from(laps)
    .innerJoin(lists, eq(lists.id, laps.listId))
    .where(and(eq(laps.organisationId, organisationId), eq(laps.campaignId, input.campaignId)));
  const campaign = await getCampaign(db, organisationId, input.campaignId);
  const plan = topUpPlan({
    amountMicro: input.amountMicro,
    partsPerMessage: campaign ? campaignMessageParts(campaign, input.linkLength) : 1,
    laps: rows.map((r) => ({
      id: r.id,
      active: r.active && r.status !== "cancelled",
      priceMicro: r.priceMicro === null ? null : Number(r.priceMicro),
    })),
  });
  if (plan.activeLaps === 0) throw new Error("No active lap to top up");
  const balance = await getBalanceMicro(db, organisationId);
  if (balance < BigInt(plan.totalMicro)) {
    const needed = (plan.totalMicro / 1_000_000).toFixed(2);
    const have = (Number(balance) / 1_000_000).toFixed(2);
    throw new Error(`Insufficient balance: the top-up needs €${needed}, the balance is €${have}`);
  }
  await db.transaction(async (tx) => {
    for (const lap of plan.laps) {
      await tx
        .update(laps)
        .set({
          budgetMicro: sql`${laps.budgetMicro} + ${BigInt(input.amountMicro)}`,
          testSize: sql`${laps.testSize} + ${lap.extra}`,
          status: sql`case when ${laps.status} = 'done' then 'queued'::lap_status else ${laps.status} end`,
          finishedAt: null,
        })
        .where(eq(laps.id, lap.id));
    }
    await recordAudit(tx, organisationId, {
      actorUserId: input.actorUserId,
      action: "lap.topup",
      targetType: "campaign",
      targetId: input.campaignId,
      details: {
        amountMicro: String(input.amountMicro),
        laps: plan.activeLaps,
        totalMicro: String(plan.totalMicro),
        newSms: plan.newSms,
        lapIds: plan.laps.map((l) => l.id),
      },
    });
  });
  return { laps: plan.activeLaps, totalMicro: plan.totalMicro, newSms: plan.newSms };
}

export interface LapCommentInput {
  lapId: string;
  comment: string;
  actorUserId: string | null;
}

/** Save the lap's note ("Add comment"); blank clears it. */
export async function setLapComment(
  db: Db,
  organisationId: string,
  input: LapCommentInput,
): Promise<LapRow> {
  const current = await lapOf(db, organisationId, input.lapId);
  const comment = input.comment.trim() === "" ? null : input.comment.trim();
  const [updated] = await db
    .update(laps)
    .set({ comment })
    .where(eq(laps.id, current.id))
    .returning();
  if (!updated) throw new Error("Lap not found");
  await recordAudit(db, organisationId, {
    actorUserId: input.actorUserId,
    action: "lap.comment",
    targetType: "campaign",
    targetId: current.campaignId,
    details: { lapId: current.id, comment },
  });
  return updated;
}

export interface RescheduleLapInput {
  lapId: string;
  scheduledAt: Date;
  actorUserId: string | null;
}

/** Hold a queued lap until `scheduledAt`; the send loop claims it after that time. */
export async function rescheduleLap(
  db: Db,
  organisationId: string,
  input: RescheduleLapInput,
): Promise<LapRow> {
  const current = await lapOf(db, organisationId, input.lapId);
  if (current.status !== "queued") throw new Error("Only a queued lap can be rescheduled");
  const [updated] = await db
    .update(laps)
    .set({ scheduledAt: input.scheduledAt })
    .where(eq(laps.id, current.id))
    .returning();
  if (!updated) throw new Error("Lap not found");
  await recordAudit(db, organisationId, {
    actorUserId: input.actorUserId,
    action: "lap.reschedule",
    targetType: "campaign",
    targetId: current.campaignId,
    details: { lapId: current.id, scheduledAt: input.scheduledAt.toISOString() },
  });
  return updated;
}

export interface FlushLapInput {
  lapId: string;
  actorUserId: string | null;
}

/** Flush the lap's list (sent flags reset) so the same contacts can be sent to again. */
export async function flushLap(
  db: Db,
  organisationId: string,
  input: FlushLapInput,
): Promise<{ listId: string; members: number }> {
  const current = await lapOf(db, organisationId, input.lapId);
  const members = await flushList(db, organisationId, current.listId);
  await recordAudit(db, organisationId, {
    actorUserId: input.actorUserId,
    action: "lap.flush",
    targetType: "campaign",
    targetId: current.campaignId,
    details: { lapId: current.id, listId: current.listId, members },
  });
  return { listId: current.listId, members };
}

export interface SetAllLapsInput {
  campaignId: string;
  on: boolean;
  actorUserId: string | null;
}

/** The All switch of the laps header: switch every unfinished lap that is not already there. */
export async function setAllLapsOn(
  db: Db,
  organisationId: string,
  input: SetAllLapsInput,
): Promise<number> {
  const rows = await db
    .select({ id: laps.id })
    .from(laps)
    .where(
      and(
        eq(laps.organisationId, organisationId),
        eq(laps.campaignId, input.campaignId),
        input.on ? eq(laps.status, "cancelled") : inArray(laps.status, ["queued", "sending"]),
      ),
    );
  for (const row of rows) {
    await setLapOn(db, organisationId, {
      lapId: row.id,
      on: input.on,
      actorUserId: input.actorUserId,
    });
  }
  return rows.length;
}
