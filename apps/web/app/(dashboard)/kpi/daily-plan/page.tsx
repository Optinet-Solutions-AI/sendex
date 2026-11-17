import { can, planGroups, planTotals, shiftIsoDay } from "@sendex/core";
import { dailyPlan, db, getDailySendTarget } from "@sendex/db";
import { DailyPlan } from "../../../../components/kpi/daily-plan";
import { parseDailyPlanQuery } from "../../../../lib/kpi-params";
import type { SearchParams } from "../../../../lib/lists-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

/** The daily plan (D5-08): the campaigns planned for a day against the daily SMS target. */
export default async function DailyPlanPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseDailyPlanQuery(await searchParams);
  return (
    <RequireOrg action="campaign.view" preview>
      {async (ctx) => {
        const database = db();
        const [rows, target] = await Promise.all([
          dailyPlan(database, ctx.organisationId, query.day),
          getDailySendTarget(database, ctx.organisationId),
        ]);
        return (
          <DailyPlan
            query={query}
            previousDay={shiftIsoDay(query.day, -1)}
            nextDay={shiftIsoDay(query.day, 1)}
            campaigns={rows}
            groups={planGroups(rows, query.by)}
            totals={planTotals(rows, target)}
            canSetTarget={can(ctx.role, "settings.manage")}
          />
        );
      }}
    </RequireOrg>
  );
}
