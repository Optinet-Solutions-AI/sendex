import { db, listPostbacks } from "@sendex/db";
import { AuthError, requireAction } from "../../../../lib/auth";
import {
  POSTBACKS_PAGE_SIZE,
  parsePostbacksQuery,
  postbackDateBounds,
  postbackTimingFilter,
  postbackTypeFilter,
  type SearchParams,
} from "../../../../lib/postbacks-params";
import { AuthErrorView } from "../../require-org";
import { PostbacksTable, type PostbackTableRow } from "./postbacks-table";

export const dynamic = "force-dynamic";

/** The postback log: SMS Edge's Postback Logs screen. Data via `listPostbacks`, scoped by organisation. */
export default async function PostbacksReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  let organisationId: string;
  try {
    organisationId = (await requireAction("campaign.view")).organisationId;
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const query = parsePostbacksQuery(await searchParams);
  const bounds = postbackDateBounds(query);
  const result = await listPostbacks(db(), organisationId, {
    type: postbackTypeFilter(query),
    timing: postbackTimingFilter(query),
    from: bounds.from,
    to: bounds.to,
    search: query.search,
    page: query.page,
    pageSize: POSTBACKS_PAGE_SIZE,
  });
  const rows: PostbackTableRow[] = result.rows.map((r) => ({
    id: r.id,
    eventKey: r.eventKey,
    type: r.type,
    dynamicId: r.dynamicId,
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    valueMicro: r.valueMicro === null ? null : Number(r.valueMicro),
    params: r.params,
    receivedAt: r.receivedAt.toISOString(),
    messageSentAt: r.messageSentAt === null ? null : r.messageSentAt.toISOString(),
    timing: r.timing,
    daysLater: r.daysLater,
  }));
  return (
    <PostbacksTable rows={rows} total={result.total} pageSize={POSTBACKS_PAGE_SIZE} query={query} />
  );
}
