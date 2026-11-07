import { and, asc, desc, eq, ilike, inArray, type SQL, sql } from "drizzle-orm";
import { suppressionImports, suppressions } from "../schema/lists.js";
import { messages } from "../schema/tracking.js";
import type { Db } from "../types.js";

/**
 * The Unsubscribe page (D4-03, phase G): account-wide suppressions the send loop skips,
 * the files they were imported from, and the lookup the Unsubscribe API uses. Numbers are
 * E.164; normalise with `normaliseSuppressionNumber` from `@sendex/core` first.
 */

export type SuppressionRow = typeof suppressions.$inferSelect;
export type SuppressionImportRow = typeof suppressionImports.$inferSelect;

const toNumber = (v: unknown): number => Number(v ?? 0);

export interface AddSuppressionsInput {
  numbers: ReadonlyArray<{ e164: string; country: string | null }>;
  /** manual (Add number), upload, api, sms (a STOP reply). */
  source: string;
  reason?: string;
  importId?: string;
}

/** Insert the numbers that are not suppressed yet; returns how many were new. */
export async function addSuppressions(
  db: Db,
  organisationId: string,
  input: AddSuppressionsInput,
): Promise<number> {
  if (input.numbers.length === 0) return 0;
  let added = 0;
  for (let i = 0; i < input.numbers.length; i += 1_000) {
    const batch = input.numbers.slice(i, i + 1_000);
    const inserted = await db
      .insert(suppressions)
      .values(
        batch.map((n) => ({
          organisationId,
          e164: n.e164,
          country: n.country,
          reason: input.reason ?? "unsubscribed",
          source: input.source,
          importId: input.importId ?? null,
        })),
      )
      .onConflictDoNothing({ target: [suppressions.organisationId, suppressions.e164] })
      .returning({ id: suppressions.id });
    added += inserted.length;
  }
  return added;
}

/** Resubscribe: remove the numbers from the suppression list. Returns how many were removed. */
export async function removeSuppressions(
  db: Db,
  organisationId: string,
  e164s: readonly string[],
): Promise<number> {
  if (e164s.length === 0) return 0;
  const removed = await db
    .delete(suppressions)
    .where(
      and(eq(suppressions.organisationId, organisationId), inArray(suppressions.e164, [...e164s])),
    )
    .returning({ id: suppressions.id });
  return removed.length;
}

export interface ListSuppressionsOptions {
  /** Digits of the number to look for. */
  search?: string;
  page: number;
  pageSize: number;
}

export interface SuppressionsPage {
  rows: SuppressionRow[];
  total: number;
}

export async function listSuppressions(
  db: Db,
  organisationId: string,
  options: ListSuppressionsOptions,
): Promise<SuppressionsPage> {
  const conditions: SQL[] = [eq(suppressions.organisationId, organisationId)];
  const digits = options.search?.replace(/\D/g, "") ?? "";
  if (digits) conditions.push(ilike(suppressions.e164, `%${digits}%`));
  const where = and(...conditions);
  const page = Math.max(1, options.page);
  const pageSize = Math.max(1, options.pageSize);
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(suppressions)
      .where(where)
      .orderBy(desc(suppressions.createdAt), asc(suppressions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)`.mapWith(toNumber) })
      .from(suppressions)
      .where(where),
  ]);
  return { rows, total: count?.total ?? 0 };
}

export interface SuppressionStats {
  numbers: number;
  imports: number;
}

export async function suppressionStats(db: Db, organisationId: string): Promise<SuppressionStats> {
  const [[numbers], [imports]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)`.mapWith(toNumber) })
      .from(suppressions)
      .where(eq(suppressions.organisationId, organisationId)),
    db
      .select({ n: sql<number>`count(*)`.mapWith(toNumber) })
      .from(suppressionImports)
      .where(eq(suppressionImports.organisationId, organisationId)),
  ]);
  return { numbers: numbers?.n ?? 0, imports: imports?.n ?? 0 };
}

export async function createSuppressionImport(
  db: Db,
  organisationId: string,
  input: { fileName: string; count: number; rejected: number },
): Promise<SuppressionImportRow> {
  const [row] = await db
    .insert(suppressionImports)
    .values({ organisationId, ...input })
    .returning();
  if (!row) throw new Error("createSuppressionImport: no row returned");
  return row;
}

export async function listSuppressionImports(
  db: Db,
  organisationId: string,
): Promise<SuppressionImportRow[]> {
  return db
    .select()
    .from(suppressionImports)
    .where(eq(suppressionImports.organisationId, organisationId))
    .orderBy(desc(suppressionImports.createdAt), asc(suppressionImports.id));
}

/**
 * The Unsubscribe API's "by dynamic variable": the contact the message with this dynamic id
 * went to is suppressed. Returns the number, or null when the id is not the organisation's.
 */
export async function suppressByDynamicId(
  db: Db,
  organisationId: string,
  dynamicId: string,
): Promise<{ e164: string; added: boolean } | null> {
  const [message] = await db
    .select({ e164: messages.e164 })
    .from(messages)
    .where(and(eq(messages.organisationId, organisationId), eq(messages.dynamicId, dynamicId)))
    .limit(1);
  if (!message) return null;
  const added = await addSuppressions(db, organisationId, {
    numbers: [{ e164: message.e164, country: null }],
    source: "api",
  });
  return { e164: message.e164, added: added > 0 };
}

/** Once the file's numbers are in, record how many the import added. */
export async function updateSuppressionImportCount(
  db: Db,
  organisationId: string,
  importId: string,
  count: number,
): Promise<void> {
  await db
    .update(suppressionImports)
    .set({ count })
    .where(
      and(
        eq(suppressionImports.organisationId, organisationId),
        eq(suppressionImports.id, importId),
      ),
    );
}
