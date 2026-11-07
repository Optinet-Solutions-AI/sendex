import { db, listLists } from "@sendex/db";
import type { NextRequest } from "next/server";
import { AuthError, requireAction } from "../../../../lib/auth";
import { csvLine } from "../../../../lib/csv";
import { parseListsQuery, type SearchParams } from "../../../../lib/lists-params";

const EXPORT_PAGE = 500;

const HEADER = [
  "Name",
  "Numbers",
  "Country",
  "Sent",
  "CTR",
  "Leads",
  "Sales",
  "Spend",
  "Last sent",
  "Last upload",
  "Created",
] as const;

/**
 * Streams the lists table as CSV with the same search, country filter and sort as the page.
 */
export async function GET(request: NextRequest): Promise<Response> {
  let organisationId: string;
  try {
    organisationId = (await requireAction("list.view")).organisationId;
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
  const params: SearchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const query = parseListsQuery(params);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvLine(HEADER)));
        let page = 1;
        for (;;) {
          const { rows } = await listLists(db(), organisationId, {
            search: query.search,
            countries: query.countries,
            archived: query.archived ? "only" : "exclude",
            sort: query.sort,
            dir: query.dir,
            page,
            pageSize: EXPORT_PAGE,
          });
          for (const row of rows) {
            controller.enqueue(
              encoder.encode(
                csvLine([
                  row.name,
                  row.numbersCount,
                  row.country,
                  row.sent,
                  `${(row.ctr * 100).toFixed(2)}%`,
                  row.leads,
                  row.sales,
                  (Number(row.spendMicro) / 1_000_000).toFixed(2),
                  row.lastSentAt,
                  row.lastUploadAt,
                  row.createdAt,
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
      "Content-Disposition": `attachment; filename="lists-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
