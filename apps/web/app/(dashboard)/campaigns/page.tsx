import { type CampaignStatus, db, listCampaigns } from "@sendex/db";
import { CampaignsTable } from "../../../components/campaigns/campaigns-table";
import { NewCampaignModal } from "../../../components/campaigns/new-campaign-modal";
import { toCampaignSummaryView } from "../../../lib/campaign-views";
import { RequireOrg } from "../require-org";

const STATUSES = new Set<string>([
  "draft",
  "scheduled",
  "sending",
  "paused",
  "stopped",
  "completed",
]);

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const search = first(params.search).trim();
  const country = first(params.country).toUpperCase();
  const status = first(params.status);
  const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);

  return (
    <RequireOrg action="campaign.view">
      {async (ctx) => {
        const result = await listCampaigns(db(), ctx.organisationId, {
          page,
          ...(search ? { search } : {}),
          ...(/^[A-Z]{2}$/.test(country) ? { country } : {}),
          ...(STATUSES.has(status) ? { status: status as CampaignStatus } : {}),
        });
        return (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold">Campaigns</h1>
              <NewCampaignModal />
            </div>
            <CampaignsTable
              items={result.items.map(toCampaignSummaryView)}
              total={result.total}
              page={result.page}
              pageSize={result.pageSize}
              filters={{ search, country, status, page }}
            />
          </section>
        );
      }}
    </RequireOrg>
  );
}
