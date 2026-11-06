import type { ListSortKey, SortDirection } from "@sendex/core";
import { and, asc, desc, eq, ilike, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { contacts, listMembers, lists, suppressions } from "../schema/lists.js";
import type { Db } from "../types.js";

export type ListRow = typeof lists.$inferSelect;

/** Members are inserted in chunks of this size; Postgres has a parameter limit per statement. */
const MEMBER_CHUNK = 1_000;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  throw new Error(`cannot convert ${String(value)} to number`);
}

const sentCountSql =
  sql<number>`(select count(*) from ${listMembers} m where m.list_id = ${lists}."id" and m.sent_at is not null)`.mapWith(
    toNumber,
  );

export interface ListListsOptions {
  search?: string;
  country?: string;
  sort?: ListSortKey;
  dir?: SortDirection;
  /** 1-based. */
  page?: number;
  pageSize: number;
}

export interface ListSummaryRow {
  id: string;
  name: string;
  country: string;
  numbersCount: number;
  /** Members with `sent_at` set. */
  sent: number;
  lastSentAt: Date | null;
  lastUploadAt: Date | null;
  createdAt: Date;
}

export interface ListListsResult {
  rows: ListSummaryRow[];
  total: number;
}

function sortColumn(key: ListSortKey): SQL | PgColumn {
  switch (key) {
    case "name":
      return lists.name;
    case "numbersCount":
      return lists.numbersCount;
    case "country":
      return lists.country;
    case "sent":
      return sentCountSql;
    case "lastSentAt":
      return lists.lastSentAt;
    case "lastUploadAt":
      return lists.lastUploadAt;
    case "createdAt":
      return lists.createdAt;
  }
}

/** Lists of an organisation with their counts, filtered, sorted and paged. */
export async function listLists(
  db: Db,
  organisationId: string,
  options: ListListsOptions,
): Promise<ListListsResult> {
  const conditions: SQL[] = [eq(lists.organisationId, organisationId)];
  const search = options.search?.trim();
  if (search) {
    conditions.push(ilike(lists.name, `%${search.replace(/[%_\\]/g, "\\$&")}%`));
  }
  if (options.country) conditions.push(eq(lists.country, options.country.toUpperCase()));
  const where = and(...conditions);

  const sort = options.sort ?? "createdAt";
  const dir = options.dir ?? (options.sort ? "asc" : "desc");
  const order = dir === "asc" ? asc(sortColumn(sort)) : desc(sortColumn(sort));
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, options.pageSize);

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: lists.id,
        name: lists.name,
        country: lists.country,
        numbersCount: lists.numbersCount,
        sent: sentCountSql,
        lastSentAt: lists.lastSentAt,
        lastUploadAt: lists.lastUploadAt,
        createdAt: lists.createdAt,
      })
      .from(lists)
      .where(where)
      .orderBy(order, asc(lists.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)`.mapWith(toNumber) })
      .from(lists)
      .where(where),
  ]);
  return { rows, total: count?.total ?? 0 };
}

export interface ListNameRow {
  id: string;
  name: string;
  country: string;
}

/** Every list of the organisation, lightest shape, for selects. */
export async function listListNames(db: Db, organisationId: string): Promise<ListNameRow[]> {
  return db
    .select({ id: lists.id, name: lists.name, country: lists.country })
    .from(lists)
    .where(eq(lists.organisationId, organisationId))
    .orderBy(asc(lists.name));
}

export interface ListCounts {
  members: number;
  /** Not bad, not sent, not suppressed. */
  available: number;
  sent: number;
  bad: number;
}

export type ListDetail = ListRow & { counts: ListCounts };

function availableWhere(organisationId: string, listId: string): SQL {
  const suppressed = sql`exists (select 1 from ${suppressions} s where s.organisation_id = ${organisationId} and s.e164 = ${contacts.e164})`;
  const where = and(
    eq(listMembers.listId, listId),
    eq(listMembers.organisationId, organisationId),
    eq(listMembers.bad, false),
    isNull(listMembers.sentAt),
    sql`not ${suppressed}`,
  );
  if (!where) throw new Error("unreachable");
  return where;
}

/** Members of the list that could still be messaged: not bad, not sent (or flushed), not suppressed. */
export async function listAvailableCount(
  db: Db,
  organisationId: string,
  listId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(toNumber) })
    .from(listMembers)
    .innerJoin(contacts, eq(contacts.id, listMembers.contactId))
    .where(availableWhere(organisationId, listId));
  return row?.count ?? 0;
}

/** One list with its counts, or null when it is not this organisation's. */
export async function getList(
  db: Db,
  organisationId: string,
  listId: string,
): Promise<ListDetail | null> {
  const [row] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.organisationId, organisationId)))
    .limit(1);
  if (!row) return null;
  const [[counts], available] = await Promise.all([
    db
      .select({
        members: sql<number>`count(*)`.mapWith(toNumber),
        sent: sql<number>`count(*) filter (where ${listMembers.sentAt} is not null)`.mapWith(
          toNumber,
        ),
        bad: sql<number>`count(*) filter (where ${listMembers.bad})`.mapWith(toNumber),
      })
      .from(listMembers)
      .where(eq(listMembers.listId, listId)),
    listAvailableCount(db, organisationId, listId),
  ]);
  return {
    ...row,
    counts: {
      members: counts?.members ?? 0,
      available,
      sent: counts?.sent ?? 0,
      bad: counts?.bad ?? 0,
    },
  };
}

export interface NewListInput {
  name: string;
  country: string;
}

export async function createList(
  db: Db,
  organisationId: string,
  input: NewListInput,
): Promise<ListRow> {
  const [row] = await db
    .insert(lists)
    .values({ organisationId, name: input.name, country: input.country.toUpperCase() })
    .returning();
  if (!row) throw new Error("createList: no row returned");
  return row;
}

/** Delete a list and its members (contacts stay). Returns true when a row was deleted. */
export async function deleteList(db: Db, organisationId: string, listId: string): Promise<boolean> {
  const deleted = await db
    .delete(lists)
    .where(and(eq(lists.id, listId), eq(lists.organisationId, organisationId)))
    .returning({ id: lists.id });
  return deleted.length > 0;
}

export interface ImportRow {
  e164: string;
  country: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | undefined;
  custom1?: string | undefined;
  custom2?: string | undefined;
  custom3?: string | undefined;
  custom4?: string | undefined;
  custom5?: string | undefined;
}

export type ImportTarget =
  | { listId: string; newList?: never }
  | { newList: NewListInput; listId?: never };

export type ImportContactsInput = ImportTarget & {
  rows: readonly ImportRow[];
  /** `skip_existing`: numbers the organisation already has as contacts are not added. */
  duplicates: "allow" | "skip_existing";
  /** Reset the sent flags of the whole list once the rows are in. */
  flushAfterImport: boolean;
};

export interface ImportContactsResult {
  listId: string;
  /** Members actually added to the list. */
  imported: number;
  /** Rows not added: known contacts under `skip_existing`, or already members of the list. */
  skippedExisting: number;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function resolveTargetList(
  db: Db,
  organisationId: string,
  input: ImportTarget,
): Promise<string> {
  if (input.newList) return (await createList(db, organisationId, input.newList)).id;
  const [row] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, input.listId), eq(lists.organisationId, organisationId)))
    .limit(1);
  if (!row) throw new Error("importContacts: list not found");
  return row.id;
}

/**
 * Import cleaned rows into a list: upsert the contacts (unique per organisation on e164,
 * provided fields overwrite, blanks keep the stored value), insert the members in chunks
 * ignoring ones already in the list, then update the list's count and upload time.
 * Rows must already be normalised E.164; run `cleanBatch` from `@sendex/core` first.
 */
export async function importContacts(
  db: Db,
  organisationId: string,
  input: ImportContactsInput,
): Promise<ImportContactsResult> {
  const listId = await resolveTargetList(db, organisationId, input);
  let imported = 0;

  for (const batch of chunk(input.rows, MEMBER_CHUNK)) {
    if (batch.length === 0) continue;
    const e164s = batch.map((r) => r.e164);
    const existing =
      input.duplicates === "skip_existing"
        ? new Set(
            (
              await db
                .select({ e164: contacts.e164 })
                .from(contacts)
                .where(
                  and(eq(contacts.organisationId, organisationId), inArray(contacts.e164, e164s)),
                )
            ).map((r) => r.e164),
          )
        : new Set<string>();
    const toImport = batch.filter((r) => !existing.has(r.e164));
    if (toImport.length === 0) continue;

    const upserted = await db
      .insert(contacts)
      .values(
        toImport.map((r) => ({
          organisationId,
          e164: r.e164,
          country: r.country.toUpperCase(),
          firstName: r.firstName ?? null,
          lastName: r.lastName ?? null,
          email: r.email ?? null,
          custom1: r.custom1 ?? null,
          custom2: r.custom2 ?? null,
          custom3: r.custom3 ?? null,
          custom4: r.custom4 ?? null,
          custom5: r.custom5 ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [contacts.organisationId, contacts.e164],
        set: {
          firstName: sql`coalesce(excluded.first_name, ${contacts.firstName})`,
          lastName: sql`coalesce(excluded.last_name, ${contacts.lastName})`,
          email: sql`coalesce(excluded.email, ${contacts.email})`,
          custom1: sql`coalesce(excluded.custom1, ${contacts.custom1})`,
          custom2: sql`coalesce(excluded.custom2, ${contacts.custom2})`,
          custom3: sql`coalesce(excluded.custom3, ${contacts.custom3})`,
          custom4: sql`coalesce(excluded.custom4, ${contacts.custom4})`,
          custom5: sql`coalesce(excluded.custom5, ${contacts.custom5})`,
        },
      })
      .returning({ id: contacts.id });

    const inserted = await db
      .insert(listMembers)
      .values(upserted.map((c) => ({ organisationId, listId, contactId: c.id })))
      .onConflictDoNothing({ target: [listMembers.listId, listMembers.contactId] })
      .returning({ id: listMembers.id });
    imported += inserted.length;
  }

  await db
    .update(lists)
    .set({
      numbersCount: sql`(select count(*) from ${listMembers} m where m.list_id = ${lists}."id")`,
      lastUploadAt: new Date(),
    })
    .where(eq(lists.id, listId));

  if (input.flushAfterImport) await flushList(db, organisationId, listId);

  return { listId, imported, skippedExisting: input.rows.length - imported };
}

/** Reset the sent flags of every member of the list, keeping bad flags. Returns members touched. */
export async function flushList(db: Db, organisationId: string, listId: string): Promise<number> {
  const updated = await db
    .update(listMembers)
    .set({ sentAt: null, flushedAt: new Date() })
    .where(and(eq(listMembers.listId, listId), eq(listMembers.organisationId, organisationId)))
    .returning({ id: listMembers.id });
  return updated.length;
}

export interface FlushAllResult {
  lists: number;
  members: number;
}

/** Flush every list of the organisation. */
export async function flushAllLists(db: Db, organisationId: string): Promise<FlushAllResult> {
  const ids = await db
    .select({ id: lists.id })
    .from(lists)
    .where(eq(lists.organisationId, organisationId));
  let members = 0;
  for (const { id } of ids) members += await flushList(db, organisationId, id);
  return { lists: ids.length, members };
}

export interface ListMemberRow {
  id: string;
  e164: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  sentAt: Date | null;
  flushedAt: Date | null;
  bad: boolean;
  badReason: string | null;
}

export interface MembersPageOptions {
  /** 1-based. */
  page: number;
  pageSize: number;
}

export interface MembersPage {
  rows: ListMemberRow[];
  total: number;
}

/** A page of a list's members with their contact fields, oldest first. */
export async function listMembersPage(
  db: Db,
  organisationId: string,
  listId: string,
  options: MembersPageOptions,
): Promise<MembersPage> {
  const where = and(eq(listMembers.listId, listId), eq(listMembers.organisationId, organisationId));
  const page = Math.max(1, options.page);
  const pageSize = Math.max(1, options.pageSize);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: listMembers.id,
        e164: contacts.e164,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        sentAt: listMembers.sentAt,
        flushedAt: listMembers.flushedAt,
        bad: listMembers.bad,
        badReason: listMembers.badReason,
      })
      .from(listMembers)
      .innerJoin(contacts, eq(contacts.id, listMembers.contactId))
      .where(where)
      .orderBy(asc(contacts.e164))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)`.mapWith(toNumber) })
      .from(listMembers)
      .where(where),
  ]);
  return { rows, total: count?.total ?? 0 };
}
