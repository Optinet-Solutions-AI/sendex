import { db, sendLog } from "@sendex/db";
import type { NextRequest } from "next/server";
import { AuthError, requireAction } from "../../../../../lib/auth";
import { logWindow, parseCampaignsLogQuery } from "../../../../../lib/campaigns-log-params";
import { csvLine } from "../../../../../lib/csv";
import { eurDecimal } from "../../../../../lib/format";
import type { SearchParams } from "../../../../../lib/lists-params";

const EXPORT_PAGE = 500;

const HEADER = [
  "Date",
  "Campaign",
  "Country",
  "List",
  "Route",
  "Sent",
  "Spend (EUR)",
  "CTR",
  "Clicks",
  "CPC (EUR)",
  "Leads",
  "Sales",
] as const;

/** Streams the Campaigns Log as CSV with the same period and countries as the page. */
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
  const params: SearchParams = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    const existing = params[key];
    params[key] = existing === undefined ? value : [...[existing].flat(), value];
  }
  const query = parseCampaignsLogQuery(params);
  const window = logWindow(query);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvLine(HEADER)));
        let page = 1;
        for (;;) {
          const { rows } = await sendLog(db(), organisationId, {
            ...window,
            countries: query.countries,
            page,
            pageSize: EXPORT_PAGE,
          });
          for (const row of rows) {
            controller.enqueue(
              encoder.encode(
                csvLine([
                  row.day,
                  row.campaignName ?? "(API / no campaign)",
                  row.country,
                  row.listName ?? "",
                  row.routeName,
                  row.sent,
                  eurDecimal(row.spendMicro),
                  `${(row.ctr * 100).toFixed(2)}%`,
                  row.clicks,
                  row.cpcMicro === null ? "" : (Number(row.cpcMicro) / 1_000_000).toFixed(4),
                  row.leads,
                  row.sales,
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
      "Content-Disposition": `attachment; filename="campaigns-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
