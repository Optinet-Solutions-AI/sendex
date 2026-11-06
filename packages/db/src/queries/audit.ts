import { and, desc, eq } from "drizzle-orm";
import { auditLog } from "../schema/core.js";
import type { Db } from "../types.js";

export type AuditLogRow = typeof auditLog.$inferSelect;
/** Alias kept for callers written against the campaigns branch. */
export type AuditRow = AuditLogRow;

export interface RecordAuditInput {
  actorUserId?: string | null;
  /** e.g. list.upload, list.flush, campaign.send */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
}

/** Append one audit log row. Never put phone numbers or message text in `details`. */
export async function recordAudit(
  db: Db,
  organisationId: string,
  input: RecordAuditInput,
): Promise<AuditLogRow> {
  const [row] = await db
    .insert(auditLog)
    .values({
      organisationId,
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
): Promise<AuditLogRow[]> {
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
