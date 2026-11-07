import { verificationSummaryCsv } from "@sendex/core";
import { db, verificationLog } from "@sendex/db";
import type { NextRequest } from "next/server";
import { AuthError, requireAction } from "../../../../lib/auth";
import type { SearchParams } from "../../../../lib/lists-params";
import { parseRoutesQuery, routesWindow } from "../../../../lib/routes-params";

/** "Download summary": the verification log of the same window as the page, as CSV. */
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
  const params: SearchParams = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    const existing = params[key];
    params[key] = existing === undefined ? value : [...[existing].flat(), value];
  }
  const query = parseRoutesQuery(params, "30d");
  const rows = await verificationLog(db(), organisationId, {
    ...routesWindow(query),
    country: query.countries[0],
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(verificationSummaryCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="verification-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
