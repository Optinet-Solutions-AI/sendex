import { formatPercent } from "@sendex/core";
import { db, listCampaigns } from "@sendex/db";
import type { NextRequest } from "next/server";
import { AuthError, requireAction } from "../../../../lib/auth";
import { campaignsListInput, parseCampaignsQuery } from "../../../../lib/campaigns-params";
import { csvLine } from "../../../../lib/csv";
import { eurDecimal } from "../../../../lib/format";
import type { SearchParams } from "../../../../lib/lists-params";

const EXPORT_PAGE = 500;

const HEADER = [
  "Id",
  "Campaign",
  "Status",
  "Country",
  "Laps",
  "Sent",
  "Clicks",
  "CTR",
  "Cost (EUR)",
  "Leads",
  "Sales",
  "First send",
  "Last send",
] as const;

/** Streams the campaigns table as CSV with the same filters as the page, every page of it. */
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
  const query = parseCampaignsQuery(params);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvLine(HEADER)));
        let page = 1;
        for (;;) {
          const { items } = await listCampaigns(db(), organisationId, {
            ...campaignsListInput(query),
            page,
            pageSize: EXPORT_PAGE,
          });
          for (const row of items) {
            controller.enqueue(
              encoder.encode(
                csvLine([
                  row.id,
                  row.name,
                  row.status,
                  row.country,
                  row.lapsCount,
                  row.sent,
                  row.clicks,
                  formatPercent(row.ctr),
                  eurDecimal(row.costMicro),
                  row.leads,
                  row.sales,
                  row.firstLapAt,
                  row.lastLapAt,
                ]),
              ),
            );
          }
          if (items.length < EXPORT_PAGE) break;
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
      "Content-Disposition": `attachment; filename="campaigns-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
