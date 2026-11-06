import { can } from "@sendex/core";
import { db, listLists } from "@sendex/db";
import { AuthError, requireAction } from "../../../lib/auth";
import { LISTS_PAGE_SIZE, parseListsQuery, type SearchParams } from "../../../lib/lists-params";
import { AuthErrorView } from "../require-org";
import { ListsTable, type ListTableRow } from "./lists-table";

export const dynamic = "force-dynamic";

/** The lists table: SMS Edge's Lists screen. Data via `listLists`, scoped by organisation. */
export default async function ListsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("list.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const query = parseListsQuery(await searchParams);
  const result = await listLists(db(), ctx.organisationId, {
    search: query.search,
    country: query.country,
    sort: query.sort,
    dir: query.dir,
    page: query.page,
    pageSize: LISTS_PAGE_SIZE,
  });
  const rows: ListTableRow[] = result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    numbersCount: r.numbersCount,
    sent: r.sent,
    lastSentAt: r.lastSentAt?.toISOString() ?? null,
    lastUploadAt: r.lastUploadAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
  return (
    <ListsTable
      rows={rows}
      total={result.total}
      pageSize={LISTS_PAGE_SIZE}
      query={query}
      canUpload={can(ctx.role, "list.upload")}
      canFlush={can(ctx.role, "list.flush")}
    />
  );
}
