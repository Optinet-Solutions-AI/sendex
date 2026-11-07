import { db, listListImports } from "@sendex/db";
import { AuthError, requireAction } from "../../../../lib/auth";
import { AuthErrorView } from "../../require-org";
import { FilesTable, type ImportJobRow } from "./files-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Contacts › Lists › Files: every import job with its counts and the expandable result. */
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("list.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const params = await searchParams;
  const search = first(params.search).trim();
  const statusRaw = first(params.status);
  const status = statusRaw === "done" || statusRaw === "failed" ? statusRaw : undefined;
  const pageRaw = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const result = await listListImports(db(), ctx.organisationId, {
    page,
    pageSize: PAGE_SIZE,
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
  });
  const rows: ImportJobRow[] = result.rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    source: r.source,
    status: r.status,
    rowsInFile: r.rowsInFile,
    valid: r.valid,
    added: r.added,
    addedGood: r.addedGood,
    addedBad: r.addedBad,
    rejected: r.rejected,
    skipped: r.skipped,
    duplicates: r.duplicates,
    dedup: r.dedup,
    summary: r.summary,
    listId: r.listId,
    listName: r.listName,
    createdAt: r.createdAt.toISOString(),
  }));
  return (
    <FilesTable
      rows={rows}
      total={result.total}
      page={page}
      pageSize={PAGE_SIZE}
      search={search}
      status={status ?? ""}
      canDelete={ctx.role !== "viewer"}
    />
  );
}
