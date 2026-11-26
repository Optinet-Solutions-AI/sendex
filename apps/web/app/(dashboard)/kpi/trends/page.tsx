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
        // For the hover explanations (D5-20): the month before's own totals over the same days,
        // and each group's leads and sales in either half of the month (days 1–15, day 16 on).
        const before = trendSummary(previous, [], through);
        const inFirstHalf = (r: { day: string }) => Number(r.day.slice(8, 10)) <= 15;
        const byHalf = (first: boolean) =>
          new Map(
            trendBreakdown(rows.filter((r) => inFirstHalf(r) === first)).map(
              (r) => [r.key, r] as const,
            ),
          );
        const firstHalf = byHalf(true);
        const secondHalf = byHalf(false);
        return (
          <Trends
            query={query}
            thisYear={now.getUTCFullYear()}
            through={through}
            summary={trendSummary(rows, previous, through)}
            before={{ leads: before.leads, sales: before.sales, conversion: before.conversion }}
            points={trendSeries(rows, previous, {
              year: query.year,
              month: query.month,
              through,
              cumulative: query.cumulative,
            })}
            breakdown={trendBreakdown(rows).map((r) => ({
              ...r,
              firstLeads: firstHalf.get(r.key)?.leads ?? 0,
              firstSales: firstHalf.get(r.key)?.sales ?? 0,
              secondLeads: secondHalf.get(r.key)?.leads ?? 0,
              secondSales: secondHalf.get(r.key)?.sales ?? 0,
            }))}
          />
        );
      }}
    </RequireOrg>
  );
}
