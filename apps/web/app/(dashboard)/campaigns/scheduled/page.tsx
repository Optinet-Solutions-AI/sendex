import { db, listScheduledCampaigns } from "@sendex/db";
import { CountPill, PageHeader } from "@sendex/ui";
import {
  type ScheduledDayView,
  ScheduledList,
} from "../../../../components/campaigns/scheduled-list";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * The calendar view (D2-08): every scheduled send of the next `days` days, grouped per day in
 * each campaign's own timezone. The window starts a day back so a send that is "today" in a
 * zone ahead of UTC is not missed.
 */
export default async function ScheduledCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const requested = Number.parseInt(first(params.days), 10);
  const days = Number.isFinite(requested)
    ? Math.min(MAX_DAYS, Math.max(1, requested))
    : DEFAULT_DAYS;
  const now = Date.now();
  const from = new Date(now - DAY_MS);
  const to = new Date(now + days * DAY_MS);

  return (
    <RequireOrg action="campaign.view">
      {async (ctx) => {
        const groups = await listScheduledCampaigns(db(), ctx.organisationId, { from, to });
        const view: ScheduledDayView[] = groups.map((g) => ({
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
        const total = view.reduce((sum, g) => sum + g.campaigns.length, 0);
        return (
          <section className="space-y-4">
            <PageHeader
              breadcrumb={[
                { label: "Campaigns", href: "/campaigns" },
                { label: "Reports" },
                { label: "Calendar" },
              ]}
              title="Scheduled sends"
              actions={
                <CountPill
                  count={total}
                  noun={`scheduled in the next ${days} days`}
                  plural={`scheduled in the next ${days} days`}
                  testId="scheduled-count"
                />
              }
            />
            <p className="text-sm text-neutral-600">
              Times are shown in each campaign's own timezone. Open a campaign to change or cancel
              its start time.
            </p>
            <ScheduledList days={view} />
          </section>
        );
      }}
    </RequireOrg>
  );
}
