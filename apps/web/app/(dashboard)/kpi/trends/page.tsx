import { throughDay, trendBreakdown, trendSeries, trendSummary } from "@sendex/core";
import { db, kpiDaily } from "@sendex/db";
import { Trends } from "../../../../components/kpi/trends";
import { parseTrendsQuery, trendsWindows } from "../../../../lib/kpi-params";
import type { SearchParams } from "../../../../lib/lists-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

/** Trends (D5-06): leads against sales across a month, next to the month before. */
export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const now = new Date();
  const query = parseTrendsQuery(await searchParams, now);
  const windows = trendsWindows(query);
  const through = throughDay(query.year, query.month, now);
  return (
    <RequireOrg action="campaign.view" preview>
      {async (ctx) => {
        const database = db();
        const [rows, previous] = await Promise.all([
          kpiDaily(database, ctx.organisationId, windows.current, query.by),
          kpiDaily(database, ctx.organisationId, windows.previous, query.by),
        ]);
        return (
          <Trends
            query={query}
            thisYear={now.getUTCFullYear()}
            through={through}
            summary={trendSummary(rows, previous, through)}
            points={trendSeries(rows, previous, {
              year: query.year,
              month: query.month,
              through,
              cumulative: query.cumulative,
            })}
            breakdown={trendBreakdown(rows)}
          />
        );
      }}
    </RequireOrg>
  );
}
