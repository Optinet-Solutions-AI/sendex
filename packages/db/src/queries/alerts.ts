import { type AlertPayloadInput, alertPayloadSchema } from "@sendex/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { organisationAlerts } from "../schema/alerts.js";
import { auditLog } from "../schema/core.js";
import type { Db } from "../types.js";

export type AlertRow = typeof organisationAlerts.$inferSelect;

export interface RaiseAlertResult {
  alert: AlertRow;
  /** False when an alert for the same (organisation, kind, period) already existed. */
  created: boolean;
}

/**
 * Raise an alert for the organisation. Idempotent per (organisation, kind, periodKey): the
 * first call inserts the row and an audit entry `alert.raise`, later calls return the stored
 * row untouched. The payload is validated with `alertPayloadSchema` from packages/core.
 */
export async function raiseAlert(
  db: Db,
  organisationId: string,
  input: AlertPayloadInput,
): Promise<RaiseAlertResult> {
  const payload = alertPayloadSchema.parse(input);
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(organisationAlerts)
      .values({
        organisationId,
        kind: payload.kind,
        periodKey: payload.periodKey,
        message: payload.message,
        details: payload.details,
      })
      .onConflictDoNothing({
        target: [
          organisationAlerts.organisationId,
          organisationAlerts.kind,
          organisationAlerts.periodKey,
        ],
      })
      .returning();
    if (inserted) {
      await tx.insert(auditLog).values({
        organisationId,
        action: "alert.raise",
        targetType: "alert",
        targetId: inserted.id,
        details: { kind: payload.kind, periodKey: payload.periodKey, ...payload.details },
      });
      return { alert: inserted, created: true };
    }
    const [existing] = await tx
      .select()
      .from(organisationAlerts)
      .where(
        and(
          eq(organisationAlerts.organisationId, organisationId),
          eq(organisationAlerts.kind, payload.kind),
          eq(organisationAlerts.periodKey, payload.periodKey),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("raiseAlert: conflict without a row");
    return { alert: existing, created: false };
  });
}

/** Unacknowledged alerts of the organisation, newest first: the dashboard banner. */
export async function listOpenAlerts(db: Db, organisationId: string): Promise<AlertRow[]> {
  return db
    .select()
    .from(organisationAlerts)
    .where(
      and(
        eq(organisationAlerts.organisationId, organisationId),
        isNull(organisationAlerts.acknowledgedAt),
      ),
    )
    .orderBy(desc(organisationAlerts.raisedAt), desc(organisationAlerts.id));
}

export interface AcknowledgeAlertInput {
  alertId: string;
  /** Local `users.id` of the owner acknowledging; recorded on the row and the audit entry. */
  userId: string;
}

/**
 * Acknowledge an open alert of the organisation. Returns the updated row, or null when the
 * alert is not the organisation's or was already acknowledged. Writes `alert.acknowledge`.
 */
export async function acknowledgeAlert(
  db: Db,
  organisationId: string,
  input: AcknowledgeAlertInput,
): Promise<AlertRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(organisationAlerts)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: input.userId })
      .where(
        and(
          eq(organisationAlerts.id, input.alertId),
          eq(organisationAlerts.organisationId, organisationId),
          isNull(organisationAlerts.acknowledgedAt),
        ),
      )
      .returning();
    if (!row) return null;
    await tx.insert(auditLog).values({
      organisationId,
      actorUserId: input.userId,
      action: "alert.acknowledge",
      targetType: "alert",
      targetId: row.id,
      details: { kind: row.kind, periodKey: row.periodKey },
    });
    return row;
  });
}
