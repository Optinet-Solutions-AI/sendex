import { segmentGroupSchema } from "@sendex/core";
import { db, getSegment, segmentNumbers } from "@sendex/db";
import type { NextRequest } from "next/server";
import { AuthError, requireAction } from "../../../../../lib/auth";
import { csvLine } from "../../../../../lib/csv";

const EXPORT_PAGE = 2_000;

/** Streams every number matching the segment as CSV (one column, full numbers). */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let organisationId: string;
  try {
    organisationId = (await requireAction("list.view")).organisationId;
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
  const { id } = await context.params;
  const segment = await getSegment(db(), organisationId, id);
  if (!segment) return Response.json({ error: "not found" }, { status: 404 });
  const definition = segmentGroupSchema.parse(segment.definition);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvLine(["Number"])));
        let page = 1;
        for (;;) {
          const numbers = await segmentNumbers(db(), organisationId, definition, {
            page,
            pageSize: EXPORT_PAGE,
          });
          for (const e164 of numbers) controller.enqueue(encoder.encode(csvLine([e164])));
          if (numbers.length < EXPORT_PAGE) break;
          page += 1;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  const safe = segment.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="segment-${safe}.csv"`,
    },
  });
}
