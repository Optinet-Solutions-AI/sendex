import { auditLog } from "../schema/core.js";
import type { Db } from "../types.js";

export type AuditLogRow = typeof auditLog.$inferSelect;

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
