import { db, listAuditEntries } from "@sendex/db";
import type { NextRequest } from "next/server";
import { parseAuditQuery } from "../../../../lib/audit-params";
import { AuthError, requireAction } from "../../../../lib/auth";
import { dayRangeBounds } from "../../../../lib/billing-params";
import { csvLine } from "../../../../lib/csv";
import type { SearchParams } from "../../../../lib/lists-params";

const EXPORT_PAGE = 500;

const HEADER = [
  "Time",
  "Actor name",
  "Actor email",
  "Action",
  "Target type",
  "Target id",
  "Details",
  "IP",
  "Entry id",
] as const;

/** Streams the audit log as CSV with the same action, actor and date filters as the page. */
export async function GET(request: NextRequest): Promise<Response> {
  let organisationId: string;
  try {
    organisationId = (await requireAction("audit.view")).organisationId;
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
  const params: SearchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const query = parseAuditQuery(params);
  const bounds = dayRangeBounds(query.from, query.to);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvLine(HEADER)));
        let page = 1;
        for (;;) {
          const { rows } = await listAuditEntries(db(), organisationId, {
            action: query.action || undefined,
            actorUserId: query.actor || undefined,
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
                  row.actorName,
                  row.actorEmail,
                  row.action,
                  row.targetType,
                  row.targetId,
                  row.details ? JSON.stringify(row.details) : null,
                  row.ip,
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

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
