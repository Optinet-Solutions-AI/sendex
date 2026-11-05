import type { DepositMethod, LedgerKind } from "@sendex/core";
import { and, asc, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import { campaigns } from "../schema/campaigns.js";
import { ledgerEntries } from "../schema/ledger.js";
import { messages } from "../schema/tracking.js";
import type { Db } from "../types.js";

export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;

/** Drivers return int8 aggregates as string, number or bigint; normalise. */
function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  throw new Error(`cannot convert ${String(value)} to bigint`);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  throw new Error(`cannot convert ${String(value)} to number`);
}

/** `date` columns come back as a string or a Date depending on the driver; keep YYYY-MM-DD. */
function toIsoDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  throw new Error(`cannot convert ${String(value)} to a day`);
}

/**
 * Scalar subquery giving the organisation's balance in micro-EUR as the sum of
 * its ledger entries (debits are negative). Embed it in a select or a where
 * clause, e.g. to check funds inside the transaction that writes a debit.
 */
export function balanceSql(organisationId: string): SQL<bigint> {
  return sql<bigint>`(select coalesce(sum(${ledgerEntries.amountMicro}), 0)::bigint from ${ledgerEntries} where ${ledgerEntries.organisationId} = ${organisationId})`.mapWith(
    toBigInt,
  );
}

/** The organisation's balance in micro-EUR. */
export async function getBalanceMicro(db: Db, organisationId: string): Promise<bigint> {
  const [row] = await db
    .select({
      balanceMicro: sql<bigint>`coalesce(sum(${ledgerEntries.amountMicro}), 0)::bigint`.mapWith(
        toBigInt,
      ),
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.organisationId, organisationId));
  return row?.balanceMicro ?? 0n;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface DateRange {
  /** Inclusive. */
  from?: Date;
  /** Exclusive. */
  to?: Date;
}

export interface ListLedgerOptions extends DateRange {
  kind?: LedgerKind;
  /** 1-based. */
  page: number;
  pageSize: number;
}

export interface ListLedgerResult {
  rows: LedgerEntryRow[];
  total: number;
}

function ledgerWhere(organisationId: string, range: DateRange, kind?: LedgerKind): SQL {
  const conditions: SQL[] = [eq(ledgerEntries.organisationId, organisationId)];
  if (kind) conditions.push(eq(ledgerEntries.kind, kind));
  if (range.from) conditions.push(gte(ledgerEntries.createdAt, range.from));
  if (range.to) conditions.push(lt(ledgerEntries.createdAt, range.to));
  const where = and(...conditions);
  if (!where) throw new Error("unreachable");
  return where;
}

/** Ledger entries of the organisation, newest first, filtered by kind and date, paged. */
export async function listLedgerEntries(
  db: Db,
  organisationId: string,
  options: ListLedgerOptions,
): Promise<ListLedgerResult> {
  const where = ledgerWhere(organisationId, options, options.kind);
  const page = Math.max(1, options.page);
  const pageSize = Math.max(1, options.pageSize);
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(ledgerEntries)
      .where(where)
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)`.mapWith(toNumber) })
      .from(ledgerEntries)
      .where(where),
  ]);
  return { rows, total: count?.total ?? 0 };
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export interface RecordDepositInput {
  /** Strictly positive micro-EUR. */
  amountMicro: bigint;
  method: DepositMethod;
  /** Bank / crypto / manual reference; unique across the platform. */
  reference: string;
  note: string | null;
  actorUserId: string | null;
}

/** A deposit with this reference has already been recorded (same idempotency key). */
export class DuplicateDepositError extends Error {
  readonly reference: string;

  constructor(reference: string) {
    super(`A deposit with reference "${reference}" has already been recorded.`);
    this.name = "DuplicateDepositError";
    this.reference = reference;
  }
}

/** The idempotency key of a deposit: one per reference, platform-wide. */
export function depositIdempotencyKey(reference: string): string {
  return `deposit:${reference}`;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ("code" in current && current.code === "23505") return true;
    if (/duplicate key value violates unique constraint/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Append a `deposit` ledger entry keyed by `deposit:<reference>`. A repeated reference
 * is rejected with `DuplicateDepositError` so a double-submitted form or a retried
 * webhook cannot credit twice. The audit row is the caller's job.
 */
export async function recordDeposit(
  db: Db,
  organisationId: string,
  input: RecordDepositInput,
): Promise<LedgerEntryRow> {
  if (input.amountMicro <= 0n) throw new Error("Deposit amount must be positive");
  const reference = input.reference.trim();
  if (reference === "") throw new Error("Deposit reference is required");
  try {
    const [row] = await db
      .insert(ledgerEntries)
      .values({
        organisationId,
        kind: "deposit",
        amountMicro: input.amountMicro,
        referenceType: input.method,
        referenceId: reference,
        idempotencyKey: depositIdempotencyKey(reference),
        note: input.note,
      })
      .returning();
    if (!row) throw new Error("recordDeposit: no row returned");
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateDepositError(reference);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface DailySummaryRow {
  /** YYYY-MM-DD, UTC. */
  day: string;
  depositsMicro: bigint;
  /** Negative or zero. */
  debitsMicro: bigint;
  refundsMicro: bigint;
  /** Either sign. */
  adjustmentsMicro: bigint;
  /** Sum of every entry of the day. */
  netMicro: bigint;
  entries: number;
}

export interface SummaryRange {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
}

const sumKind = (kind: LedgerKind) =>
  sql<bigint>`coalesce(sum(${ledgerEntries.amountMicro}) filter (where ${ledgerEntries.kind} = ${kind}), 0)::bigint`.mapWith(
    toBigInt,
  );

/** Per UTC day: deposits, debits, refunds, adjustments and net (the Billing Summary tab). */
export async function dailySummary(
  db: Db,
  organisationId: string,
  range: SummaryRange,
): Promise<DailySummaryRow[]> {
  const day = sql`(${ledgerEntries.createdAt} at time zone 'UTC')::date`;
  return db
    .select({
      day: sql<string>`${day}`.mapWith(toIsoDay),
      depositsMicro: sumKind("deposit"),
      debitsMicro: sumKind("debit"),
      refundsMicro: sumKind("refund"),
      adjustmentsMicro: sumKind("adjustment"),
      netMicro: sql<bigint>`coalesce(sum(${ledgerEntries.amountMicro}), 0)::bigint`.mapWith(
        toBigInt,
      ),
      entries: sql<number>`count(*)`.mapWith(toNumber),
    })
    .from(ledgerEntries)
    .where(ledgerWhere(organisationId, range))
    .groupBy(day)
    .orderBy(asc(day));
}

export interface CampaignSpendRow {
  campaignId: string;
  campaignName: string;
  /** Negative or zero. */
  debitsMicro: bigint;
  refundsMicro: bigint;
  netMicro: bigint;
  /** Distinct messages with at least one entry in the range. */
  messages: number;
}

/**
 * Message debits and refunds in the range grouped by campaign. Entries are joined to
 * `messages` through `reference_type = 'message'` / `reference_id = messages.id`; entries
 * with another reference type (manual deposits, adjustments) are not spend and are left out.
 */
export async function spendByCampaign(
  db: Db,
  organisationId: string,
  range: SummaryRange,
): Promise<CampaignSpendRow[]> {
  const where = and(
    ledgerWhere(organisationId, range),
    eq(ledgerEntries.referenceType, "message"),
    eq(messages.organisationId, organisationId),
  );
  return db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      debitsMicro: sumKind("debit"),
      refundsMicro: sumKind("refund"),
      netMicro: sql<bigint>`coalesce(sum(${ledgerEntries.amountMicro}), 0)::bigint`.mapWith(
        toBigInt,
      ),
      messages: sql<number>`count(distinct ${messages.id})`.mapWith(toNumber),
    })
    .from(ledgerEntries)
    .innerJoin(messages, sql`${messages.id}::text = ${ledgerEntries.referenceId}`)
    .innerJoin(campaigns, eq(campaigns.id, messages.campaignId))
    .where(where)
    .groupBy(campaigns.id, campaigns.name)
    .orderBy(asc(campaigns.name), asc(campaigns.id));
}
