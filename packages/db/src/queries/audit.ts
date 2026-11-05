import { and, desc, eq } from "drizzle-orm";
import { auditLog } from "../schema/core.js";
import type { Db } from "../types.js";

export type AuditRow = typeof auditLog.$inferSelect;

export interface RecordAuditInput {
  organisationId: string;
  actorUserId?: string | null;
  /** e.g. campaign.send, campaign.create */
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Append one audit row. Never updated or deleted by application code. */
export async function recordAudit(db: Db, input: RecordAuditInput): Promise<AuditRow> {
  const [row] = await db
    .insert(auditLog)
    .values({
      organisationId: input.organisationId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      details: input.details ?? null,
      ip: input.ip ?? null,
    })
    .returning();
  if (!row) throw new Error("recordAudit: no row returned");
  return row;
}

export interface ListAuditInput {
  targetType: string;
  targetId: string;
  limit?: number;
}

/** Audit entries of one target (e.g. a campaign), newest first. */
export async function listAuditLog(
  db: Db,
  organisationId: string,
  input: ListAuditInput,
): Promise<AuditRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.organisationId, organisationId),
        eq(auditLog.targetType, input.targetType),
        eq(auditLog.targetId, input.targetId),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(input.limit ?? 100);
}
