import { dailySummary, db, listLedgerEntries } from "@sendex/db";
import type { NextRequest } from "next/server";
import { AuthError, requireAction } from "../../../../lib/auth";
import {
  dayRangeBounds,
  defaultSummaryRange,
  parseBillingQuery,
} from "../../../../lib/billing-params";
import { csvLine } from "../../../../lib/csv";
import { eurDecimal } from "../../../../lib/format";
import type { SearchParams } from "../../../../lib/lists-params";

const EXPORT_PAGE = 500;

const TRANSACTIONS_HEADER = [
  "Date",
  "Kind",
  "Amount (EUR)",
  "Reference type",
  "Reference",
  "Note",
  "Entry id",
] as const;

const SUMMARY_HEADER = [
  "Date",
  "Deposits (EUR)",
  "Debits (EUR)",
  "Refunds (EUR)",
  "Adjustments (EUR)",
  "Net (EUR)",
  "Entries",
] as const;

function csvResponse(stream: ReadableStream<Uint8Array>, name: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * CSV exports of the billing page. `?report=transactions` streams the ledger with the same
 * kind and date filters as the Transactions tab; `?report=summary` returns the daily
 * summary of the Summary tab's range (last thirty days by default).
 */
export async function GET(request: NextRequest): Promise<Response> {
  let organisationId: string;
  try {
    organisationId = (await requireAction("settings.view")).organisationId;
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
  const params: SearchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const query = parseBillingQuery(params);
  const report = params.report === "summary" ? "summary" : "transactions";
  const encoder = new TextEncoder();

  if (report === "summary") {
    const fallback = defaultSummaryRange();
    const bounds = dayRangeBounds(query.from || fallback.from, query.to || fallback.to);
    if (!bounds.from || !bounds.to) throw new Error("unreachable");
    const rows = await dailySummary(db(), organisationId, { from: bounds.from, to: bounds.to });
    const body = [
      csvLine(SUMMARY_HEADER),
      ...rows.map((r) =>
        csvLine([
          r.day,
          eurDecimal(r.depositsMicro),
          eurDecimal(r.debitsMicro),
          eurDecimal(r.refundsMicro),
          eurDecimal(r.adjustmentsMicro),
          eurDecimal(r.netMicro),
          r.entries,
        ]),
      ),
    ].join("");
    return csvResponse(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }),
      "billing-summary",
    );
  }

  const bounds = dayRangeBounds(query.from, query.to);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvLine(TRANSACTIONS_HEADER)));
        let page = 1;
        for (;;) {
          const { rows } = await listLedgerEntries(db(), organisationId, {
            kind: query.kind || undefined,
            from: bounds.from,
            to: bounds.to,
            page,
            pageSize: EXPORT_PAGE,
          });
          for (const row of rows) {
            controller.enqueue(
              encoder.encode(
                csvLine([
                  row.createdAt,
                  row.kind,
                  eurDecimal(row.amountMicro),
                  row.referenceType,
                  row.referenceId,
                  row.note,
                  row.id,
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
  return csvResponse(stream, "transactions");
}
