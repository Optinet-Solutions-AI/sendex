import { db, listPostbacks } from "@sendex/db";
import type { NextRequest } from "next/server";
import { AuthError, requireAction } from "../../../../../lib/auth";
import { csvLine } from "../../../../../lib/csv";
import {
  parsePostbacksQuery,
  postbackDateBounds,
  postbackTimingFilter,
  postbackTypeFilter,
  type SearchParams,
} from "../../../../../lib/postbacks-params";

const EXPORT_PAGE = 500;

const HEADER = [
  "Event key",
  "Type",
  "Campaign",
  "Dynamic id",
  "Value (EUR)",
  "Parameters",
  "Received",
  "SMS sent",
  "Timing",
  "Days later",
] as const;

/** Streams the postback log as CSV with the same type, timing, period and search as the page. */
export async function GET(request: NextRequest): Promise<Response> {
  let organisationId: string;
  try {
    organisationId = (await requireAction("campaign.view")).organisationId;
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
  const params: SearchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const query = parsePostbacksQuery(params);
  const bounds = postbackDateBounds(query);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvLine(HEADER)));
        let page = 1;
        for (;;) {
          const { rows } = await listPostbacks(db(), organisationId, {
            type: postbackTypeFilter(query),
            timing: postbackTimingFilter(query),
            from: bounds.from,
            to: bounds.to,
            search: query.search,
            page,
            pageSize: EXPORT_PAGE,
          });
          for (const row of rows) {
            controller.enqueue(
              encoder.encode(
                csvLine([
                  row.eventKey,
                  row.type,
                  row.campaignName,
                  row.dynamicId,
                  row.valueMicro === null ? null : (Number(row.valueMicro) / 1_000_000).toFixed(2),
                  JSON.stringify(row.params),
                  row.receivedAt,
                  row.messageSentAt,
                  row.timing === null ? "" : row.timing === "late" ? "late" : "same day",
                  row.daysLater,
                ]),
              ),
            );
          }
          if (rows.length < EXPORT_PAGE) break;
          page += 1;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="postbacks-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
