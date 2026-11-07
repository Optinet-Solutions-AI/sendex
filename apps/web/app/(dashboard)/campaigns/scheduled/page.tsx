import { calendarKpis, type DayCell, dayCells, monthGrid, weekGrid } from "@sendex/core";
import { db, listScheduledCampaigns, sendCalendar } from "@sendex/db";
import { CountPill, KpiStrip, PageHeader } from "@sendex/ui";
import {
  type ScheduledDayView,
  ScheduledList,
} from "../../../../components/campaigns/scheduled-list";
import { SendCalendar } from "../../../../components/reports/send-calendar";
import { calendarSpan, parseCalendarQuery } from "../../../../lib/calendar-params";
import { formatNumber } from "../../../../lib/format";
import type { SearchParams } from "../../../../lib/lists-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_DAYS = 30;

/**
 * The Send Calendar (D4-05): month KPIs, the Monday-first grid of past sends per day and
 * country, the day modal, and under it the upcoming scheduled sends of the next 30 days
 * (D2-08), grouped per day in each campaign's own timezone.
 */
export default async function SendCalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const now = new Date();
  const query = parseCalendarQuery(await searchParams, now);
  const span = calendarSpan(query);
  const grid = query.view === "week" ? [weekGrid(query.day)] : monthGrid(query.year, query.month);
  const today = now.toISOString().slice(0, 10);

  return (
    <RequireOrg action="campaign.view">
      {async (ctx) => {
        const [stats, groups] = await Promise.all([
          sendCalendar(db(), ctx.organisationId, span),
          listScheduledCampaigns(db(), ctx.organisationId, {
            from: new Date(now.getTime() - DAY_MS),
            to: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS),
          }),
        ]);
        const kpis = calendarKpis(stats);
        const cells: Record<string, DayCell> = Object.fromEntries(dayCells(stats));
        const upcoming: ScheduledDayView[] = groups.map((g) => ({
          day: g.day,
          campaigns: g.campaigns.map((c) => ({
            id: c.id,
            name: c.name,
            country: c.country,
            timezone: c.timezone,
            status: c.status,
            scheduledAt: c.scheduledAt.toISOString(),
            localTime: c.localTime,
            lapsCount: c.lapsCount,
            smsCount: c.smsCount,
          })),
        }));
        const upcomingTotal = upcoming.reduce((sum, g) => sum + g.campaigns.length, 0);
        return (
          <section className="space-y-5">
            <PageHeader
              breadcrumb={[
                { label: "Campaigns", href: "/campaigns" },
                { label: "Reports" },
                { label: "Calendar" },
              ]}
              title="Send Calendar"
              subtitle="What went out each day, by country. Click a country for its campaigns."
            />
            <KpiStrip
              label="Period totals"
              items={[
                { label: "Sent", value: formatNumber(kpis.sent), testId: "calendar-kpi-sent" },
                {
                  label: "Clicks",
                  value: formatNumber(kpis.clicks),
                  testId: "calendar-kpi-clicks",
                },
                {
                  label: "CTR",
                  value: `${(kpis.ctr * 100).toFixed(2)}%`,
                  testId: "calendar-kpi-ctr",
                },
                {
                  label: "Countries",
                  value: formatNumber(kpis.countries),
                  testId: "calendar-kpi-countries",
                },
                {
                  label: "Campaign sends",
                  value: formatNumber(kpis.campaignSends),
                  testId: "calendar-kpi-campaign-sends",
                },
              ]}
            />
            <SendCalendar
              query={query}
              grid={grid}
              cells={cells}
              today={today}
              countryDays={kpis.countryDays}
            />
            <section className="space-y-3" data-testid="scheduled-sends">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-base font-semibold text-ink">Scheduled sends</h2>
                <CountPill
                  count={upcomingTotal}
                  noun={`scheduled in the next ${UPCOMING_DAYS} days`}
                  plural={`scheduled in the next ${UPCOMING_DAYS} days`}
                  testId="scheduled-count"
                />
              </div>
              <p className="text-sm text-muted">
                Times are shown in each campaign's own timezone. Open a campaign to change or cancel
                its start time.
              </p>
              <ScheduledList days={upcoming} />
            </section>
          </section>
        );
      }}
    </RequireOrg>
  );
}
