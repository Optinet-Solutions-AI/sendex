import { and, asc, desc, eq, gte, isNotNull, lt, type SQL, sql } from "drizzle-orm";
import { auditLog, users } from "../schema/core.js";
import type { Db } from "../types.js";

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  throw new Error(`cannot convert ${String(value)} to number`);
}

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

// ---------------------------------------------------------------------------
// The audit log page (D3-10)
// ---------------------------------------------------------------------------

export interface ListAuditEntriesOptions {
  action?: string;
  actorUserId?: string;
  /** Inclusive. */
  from?: Date;
  /** Exclusive. */
  to?: Date;
  /** 1-based. */
  page: number;
  pageSize: number;
}

/** An audit row with the actor's name and email joined (null for worker-written rows). */
export interface AuditEntryRow {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: Date;
}

export interface ListAuditEntriesResult {
  rows: AuditEntryRow[];
  total: number;
}

function auditWhere(organisationId: string, options: ListAuditEntriesOptions): SQL {
  const conditions: SQL[] = [eq(auditLog.organisationId, organisationId)];
  if (options.action) conditions.push(eq(auditLog.action, options.action));
  if (options.actorUserId) conditions.push(eq(auditLog.actorUserId, options.actorUserId));
  if (options.from) conditions.push(gte(auditLog.createdAt, options.from));
  if (options.to) conditions.push(lt(auditLog.createdAt, options.to));
  const where = and(...conditions);
  if (!where) throw new Error("unreachable");
  return where;
}

/** Audit entries of the organisation, newest first, filtered and paged, with the actor. */
export async function listAuditEntries(
  db: Db,
  organisationId: string,
  options: ListAuditEntriesOptions,
): Promise<ListAuditEntriesResult> {
  const where = auditWhere(organisationId, options);
  const page = Math.max(1, options.page);
  const pageSize = Math.max(1, options.pageSize);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        actorUserId: auditLog.actorUserId,
        actorName: users.name,
        actorEmail: users.email,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        details: auditLog.details,
        ip: auditLog.ip,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(where)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)`.mapWith(toNumber) })
      .from(auditLog)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, details: r.details ?? null })),
    total: count?.total ?? 0,
  };
}

/** The distinct actions recorded for the organisation, sorted: the action filter options. */
export async function listAuditActions(db: Db, organisationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.organisationId, organisationId))
    .orderBy(asc(auditLog.action));
  return rows.map((r) => r.action);
}

export interface AuditActor {
  id: string;
  name: string | null;
  email: string;
}

/** Users who have at least one audit row in the organisation: the actor filter options. */
export async function listAuditActors(db: Db, organisationId: string): Promise<AuditActor[]> {
  return db
    .selectDistinct({ id: users.id, name: users.name, email: users.email })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(eq(auditLog.organisationId, organisationId), isNotNull(auditLog.actorUserId)))
    .orderBy(asc(users.email));
}
