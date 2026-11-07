import { can, segmentGroupSchema } from "@sendex/core";
import { db, listSegments } from "@sendex/db";
import { SegmentsTable, type SegmentsTabView } from "../../../components/segments/segments-table";
import type { SegmentView } from "../../../components/segments/types";
import { AuthError, requireAction } from "../../../lib/auth";
import { AuthErrorView } from "../require-org";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function toSegmentView(row: {
  id: string;
  name: string;
  summary: string;
  definition: unknown;
  isTemplate: boolean;
  globalExclude: boolean;
  size: number | null;
  good: number | null;
  statsAt: Date | null;
  createdAt: Date;
}): SegmentView {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    definition: segmentGroupSchema.parse(row.definition),
    isTemplate: row.isTemplate,
    globalExclude: row.globalExclude,
    size: row.size,
    good: row.good,
    statsAt: row.statsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Contacts › Segments: the list with its All, Templates and Global Excludes tabs. */
export default async function SegmentsPage({
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
  const query = await searchParams;
  const tabRaw = first(query.tab);
  const tab: SegmentsTabView = tabRaw === "templates" || tabRaw === "excludes" ? tabRaw : "all";
  const search = first(query.search).trim();
  const listing = await listSegments(db(), ctx.organisationId, {
    tab,
    ...(search ? { search } : {}),
  });
  return (
    <SegmentsTable
      rows={listing.rows.map(toSegmentView)}
      counts={listing.counts}
      tab={tab}
      search={search}
      canEdit={can(ctx.role, "list.upload")}
      canDelete={can(ctx.role, "list.delete")}
    />
  );
}
