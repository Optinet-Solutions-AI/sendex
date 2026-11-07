import { and, asc, desc, eq, ilike, type SQL, sql } from "drizzle-orm";
import { listImports, lists } from "../schema/lists.js";
import type { Db } from "../types.js";

/**
 * Import jobs (D4-03): one row per uploaded file or paste, with the counts the Files page
 * and a list's Data Files tab show, and the full summary as JSON. Every helper is scoped
 * by organisation.
 */

export type ListImportRow = typeof listImports.$inferSelect;

export interface NewListImport {
  listId: string;
  fileName: string;
  source: "file" | "paste";
  status?: "done" | "failed";
  rowsInFile: number;
  valid: number;
  added: number;
  addedGood: number;
  addedBad: number;
  rejected: number;
  skipped: number;
  duplicates: number;
  dedup: boolean;
  summary: Record<string, unknown>;
}

export async function createListImport(
  db: Db,
  organisationId: string,
  input: NewListImport,
): Promise<ListImportRow> {
  const [owned] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, input.listId), eq(lists.organisationId, organisationId)))
    .limit(1);
  if (!owned) throw new Error("List not found");
  const [row] = await db
    .insert(listImports)
    .values({ organisationId, ...input, status: input.status ?? "done" })
    .returning();
  if (!row) throw new Error("createListImport: no row returned");
  return row;
}

export interface ListImportSummary extends ListImportRow {
  listName: string;
}

export interface ListImportsOptions {
  listId?: string;
  search?: string;
  status?: "done" | "failed";
  /** 1-based. */
  page: number;
  pageSize: number;
}

export interface ListImportsPage {
  rows: ListImportSummary[];
  total: number;
}

const toNumber = (v: unknown): number => Number(v);

/** Imports of the organisation (or of one list), newest first, with the list's name. */
export async function listListImports(
  db: Db,
  organisationId: string,
  options: ListImportsOptions,
): Promise<ListImportsPage> {
  const conditions: SQL[] = [eq(listImports.organisationId, organisationId)];
  if (options.listId) conditions.push(eq(listImports.listId, options.listId));
  if (options.status) conditions.push(eq(listImports.status, options.status));
  const search = options.search?.trim();
  if (search) {
    conditions.push(ilike(listImports.fileName, `%${search.replace(/[%_\\]/g, "\\$&")}%`));
  }
  const where = and(...conditions);
  const page = Math.max(1, options.page);
  const pageSize = Math.max(1, options.pageSize);
  const [rows, [count]] = await Promise.all([
    db
      .select({ job: listImports, listName: lists.name })
      .from(listImports)
      .innerJoin(lists, eq(lists.id, listImports.listId))
      .where(where)
      .orderBy(desc(listImports.createdAt), asc(listImports.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)`.mapWith(toNumber) })
      .from(listImports)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r.job, listName: r.listName })),
    total: count?.total ?? 0,
  };
}

export async function getListImport(
  db: Db,
  organisationId: string,
  importId: string,
): Promise<ListImportSummary | null> {
  const [row] = await db
    .select({ job: listImports, listName: lists.name })
    .from(listImports)
    .innerJoin(lists, eq(lists.id, listImports.listId))
    .where(and(eq(listImports.organisationId, organisationId), eq(listImports.id, importId)))
    .limit(1);
  return row ? { ...row.job, listName: row.listName } : null;
}

/** Delete the import record (the numbers it added stay in the list). */
export async function deleteListImport(
  db: Db,
  organisationId: string,
  importId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(listImports)
    .where(and(eq(listImports.organisationId, organisationId), eq(listImports.id, importId)))
    .returning({ id: listImports.id });
  return deleted.length > 0;
}
