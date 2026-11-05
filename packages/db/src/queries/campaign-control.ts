import {
  type CampaignControlStatus,
  campaignTransition,
  localDayAndTime,
  type TransitionContext,
} from "@sendex/core";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { campaigns, laps } from "../schema/campaigns.js";
import { auditLog } from "../schema/core.js";
import { messages } from "../schema/tracking.js";
import type { Db } from "../types.js";
import { recordAudit } from "./audit.js";
import type { CampaignRow, CampaignStatus } from "./campaigns.js";
import { refundMessages } from "./sending.js";

/**
 * Pause, resume, stop and (re)schedule (D2-08, D2-09). Each helper runs in one transaction:
 * it locks the campaign row, applies `campaignTransition` from `@sendex/core`, updates the
 * laps and messages the move affects and writes the audit row. The worker reacts to the
 * new status on its own (docs/engineering/sending-engine.md, "Pause and stop").
 */

export interface ControlInput {
  actorUserId?: string | null;
}

interface ControlResult {
  status: CampaignStatus;
}

export interface StopResult extends ControlResult {
  cancelledLaps: number;
  cancelledMessages: number;
}

export interface RescheduleInput extends ControlInput {
  scheduledAt: Date;
}

export interface RescheduleResult extends ControlResult {
  scheduledAt: Date;
}

export interface CancelScheduleResult extends ControlResult {
  cancelledLaps: number;
}

/** The campaign, locked for the rest of the transaction; throws when not the organisation's. */
async function lockCampaign(tx: Db, organisationId: string, id: string): Promise<CampaignRow> {
  const [row] = await tx
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.organisationId, organisationId), eq(campaigns.id, id)))
    .for("update");
  if (!row) throw new Error("Campaign not found");
  return row;
}

function context(row: CampaignRow, now: Date): TransitionContext {
  return {
    scheduledInFuture: row.scheduledAt !== null && row.scheduledAt.getTime() > now.getTime(),
  };
}

async function setStatus(tx: Db, id: string, status: CampaignControlStatus): Promise<void> {
  await tx.update(campaigns).set({ status, updatedAt: new Date() }).where(eq(campaigns.id, id));
}

/**
 * Cancel the campaign's laps in `fromStatuses`, one `lap.cancel` audit row per lap, and return
 * the counts. Queued messages are cancelled and refunded only for laps that were still
 * `queued`: a `sending` lap's job may have a batch at the provider right now, and marking
 * those rows cancelled would refund messages that are going out. The send loop cancels the
 * queued messages of a sending lap itself when it sees the stop (between batches, or when a
 * parked job wakes on a cancelled lap).
 */
async function cancelLaps(
  tx: Db,
  organisationId: string,
  campaignId: string,
  fromStatuses: readonly ("queued" | "sending")[],
  reason: string,
): Promise<{ cancelledLaps: number; cancelledMessages: number }> {
  const targets = await tx
    .select({ id: laps.id, status: laps.status })
    .from(laps)
    .where(and(eq(laps.campaignId, campaignId), inArray(laps.status, [...fromStatuses])))
    .for("update");
  if (targets.length === 0) return { cancelledLaps: 0, cancelledMessages: 0 };
  const lapIds = targets.map((l) => l.id);
  await tx
    .update(laps)
    .set({ status: "cancelled", finishedAt: sql`now()` })
    .where(inArray(laps.id, lapIds));
  const neverStarted = targets.filter((l) => l.status === "queued").map((l) => l.id);
  const cancelledMessages =
    neverStarted.length === 0
      ? []
      : await tx
          .update(messages)
          .set({ status: "cancelled" })
          .where(and(inArray(messages.lapId, neverStarted), eq(messages.status, "queued")))
          .returning({ id: messages.id, lapId: messages.lapId });
  await refundMessages(
    tx,
    organisationId,
    cancelledMessages.map((m) => m.id),
    "cancelled",
  );
  const perLap = new Map<string, number>();
  for (const m of cancelledMessages) perLap.set(m.lapId, (perLap.get(m.lapId) ?? 0) + 1);
  await tx.insert(auditLog).values(
    lapIds.map((lapId) => ({
      organisationId,
      action: "lap.cancel",
      targetType: "lap",
      targetId: lapId,
      details: { reason, cancelledMessages: perLap.get(lapId) ?? 0 },
    })),
  );
  return { cancelledLaps: lapIds.length, cancelledMessages: cancelledMessages.length };
}

/** `sending | scheduled -> paused`. The dispatcher claims nothing more; running laps park. */
export async function pauseCampaign(
  db: Db,
  organisationId: string,
  campaignId: string,
  input: ControlInput,
): Promise<ControlResult> {
  return db.transaction(async (tx) => {
    const row = await lockCampaign(tx, organisationId, campaignId);
    const status = campaignTransition(row.status, "pause");
    await setStatus(tx, campaignId, status);
    await recordAudit(tx, organisationId, {
      actorUserId: input.actorUserId ?? null,
      action: "campaign.pause",
      targetType: "campaign",
      targetId: campaignId,
      details: { from: row.status },
    });
    return { status };
  });
}

/** `paused -> sending` (or `scheduled` when the start time is still ahead). */
export async function resumeCampaign(
  db: Db,
  organisationId: string,
  campaignId: string,
  input: ControlInput,
): Promise<ControlResult> {
  return db.transaction(async (tx) => {
    const row = await lockCampaign(tx, organisationId, campaignId);
    const status = campaignTransition(row.status, "resume", context(row, new Date()));
    await setStatus(tx, campaignId, status);
    await recordAudit(tx, organisationId, {
      actorUserId: input.actorUserId ?? null,
      action: "campaign.resume",
      targetType: "campaign",
      targetId: campaignId,
      details: { to: status },
    });
    return { status };
  });
}

/**
 * `sending | scheduled | paused -> stopped`: every queued or sending lap becomes `cancelled`,
 * their queued messages are cancelled and refunded. Messages already handed to a provider
 * stay as they are. Terminal: a stopped campaign cannot be resumed.
 */
export async function stopCampaign(
  db: Db,
  organisationId: string,
  campaignId: string,
  input: ControlInput,
): Promise<StopResult> {
  return db.transaction(async (tx) => {
    const row = await lockCampaign(tx, organisationId, campaignId);
    const status = campaignTransition(row.status, "stop");
    const counts = await cancelLaps(
      tx,
      organisationId,
      campaignId,
      ["queued", "sending"],
      "campaign stopped",
    );
    await setStatus(tx, campaignId, status);
    await recordAudit(tx, organisationId, {
      actorUserId: input.actorUserId ?? null,
      action: "campaign.stop",
      targetType: "campaign",
      targetId: campaignId,
      details: { from: row.status, ...counts },
    });
    return { status, ...counts };
  });
}

/**
 * Move the start of a `draft` or `scheduled` campaign. Queued laps stay queued: the dispatcher
 * only looks at `campaigns.scheduled_at`, so the old time no longer fires.
 */
export async function rescheduleCampaign(
  db: Db,
  organisationId: string,
  campaignId: string,
  input: RescheduleInput,
): Promise<RescheduleResult> {
  return db.transaction(async (tx) => {
    const row = await lockCampaign(tx, organisationId, campaignId);
    const status = campaignTransition(row.status, "reschedule");
    await tx
      .update(campaigns)
      .set({ status, scheduledAt: input.scheduledAt, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    await recordAudit(tx, organisationId, {
      actorUserId: input.actorUserId ?? null,
      action: "campaign.reschedule",
      targetType: "campaign",
      targetId: campaignId,
      details: {
        from: row.scheduledAt?.toISOString() ?? null,
        to: input.scheduledAt.toISOString(),
      },
    });
    return { status, scheduledAt: input.scheduledAt };
  });
}

/**
 * Drop the start time. A `scheduled` campaign's queued laps are cancelled (nothing has been
 * sent, so there is nothing to refund) and it goes back to `draft`, ready to be sent again.
 */
export async function cancelSchedule(
  db: Db,
  organisationId: string,
  campaignId: string,
  input: ControlInput,
): Promise<CancelScheduleResult> {
  return db.transaction(async (tx) => {
    const row = await lockCampaign(tx, organisationId, campaignId);
    const status = campaignTransition(row.status, "cancel_schedule");
    const counts =
      row.status === "scheduled"
        ? await cancelLaps(tx, organisationId, campaignId, ["queued"], "schedule cancelled")
        : { cancelledLaps: 0 };
    await tx
      .update(campaigns)
      .set({ status, scheduledAt: null, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    await recordAudit(tx, organisationId, {
      actorUserId: input.actorUserId ?? null,
      action: "campaign.schedule_cancel",
      targetType: "campaign",
      targetId: campaignId,
      details: {
        from: row.status,
        scheduledAt: row.scheduledAt?.toISOString() ?? null,
        cancelledLaps: counts.cancelledLaps,
      },
    });
    return { status, cancelledLaps: counts.cancelledLaps };
  });
}

// ---------------------------------------------------------------------------
// The scheduled view
// ---------------------------------------------------------------------------

export interface ScheduledCampaign {
  id: string;
  name: string;
  country: string;
  timezone: string;
  status: CampaignStatus;
  scheduledAt: Date;
  /** `HH:mm` wall-clock time in the campaign timezone. */
  localTime: string;
  /** Queued laps waiting for the start time. */
  lapsCount: number;
  /** Messages those laps will send. */
  smsCount: number;
}

export interface ScheduledDay {
  /** `YYYY-MM-DD` in the campaign timezone. */
  day: string;
  campaigns: ScheduledCampaign[];
}

export interface ScheduledRange {
  /** Inclusive, UTC. */
  from: Date;
  /** Exclusive, UTC. */
  to: Date;
}

/**
 * Scheduled (and paused-with-a-start-time) campaigns whose start falls in the range, grouped
 * per calendar day of each campaign's own timezone and ordered by start time. The day is
 * computed in JS from the IANA zone so the database needs no timezone tables.
 */
export async function listScheduledCampaigns(
  db: Db,
  organisationId: string,
  range: ScheduledRange,
): Promise<ScheduledDay[]> {
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      country: campaigns.country,
      timezone: campaigns.timezone,
      status: campaigns.status,
      scheduledAt: campaigns.scheduledAt,
      lapsCount: sql<number>`count(${laps.id}) filter (where ${laps.status} = 'queued')`.mapWith(
        Number,
      ),
      smsCount:
        sql<number>`coalesce(sum(${laps.testSize}) filter (where ${laps.status} = 'queued'), 0)`.mapWith(
          Number,
        ),
    })
    .from(campaigns)
    .leftJoin(laps, eq(laps.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.organisationId, organisationId),
        inArray(campaigns.status, ["scheduled", "paused"]),
        gte(campaigns.scheduledAt, range.from),
        lt(campaigns.scheduledAt, range.to),
      ),
    )
    .groupBy(campaigns.id)
    .orderBy(asc(campaigns.scheduledAt), asc(campaigns.name));

  const days = new Map<string, ScheduledCampaign[]>();
  for (const row of rows) {
    if (!row.scheduledAt) continue;
    const { day, time } = localDayAndTime(row.scheduledAt, row.timezone);
    const entry: ScheduledCampaign = {
      id: row.id,
      name: row.name,
      country: row.country,
      timezone: row.timezone,
      status: row.status,
      scheduledAt: row.scheduledAt,
      localTime: time,
      lapsCount: row.lapsCount,
      smsCount: row.smsCount,
    };
    const list = days.get(day);
    if (list) list.push(entry);
    else days.set(day, [entry]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => ({
      day,
      campaigns: items.sort(
        (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.name.localeCompare(b.name),
      ),
    }));
}
