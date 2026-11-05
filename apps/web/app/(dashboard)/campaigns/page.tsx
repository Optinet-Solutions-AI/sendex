import { db, listCampaigns } from "@sendex/db";
import { CampaignsTable } from "../../../components/campaigns/campaigns-table";
import { NewCampaignModal } from "../../../components/campaigns/new-campaign-modal";
import { toCampaignSummaryView } from "../../../lib/campaign-views";
import { campaignsListInput, parseCampaignsQuery } from "../../../lib/campaigns-params";
import type { SearchParams } from "../../../lib/lists-params";
import { RequireOrg } from "../require-org";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseCampaignsQuery(await searchParams);

  return (
    <RequireOrg action="campaign.view">
      {async (ctx) => {
        const result = await listCampaigns(db(), ctx.organisationId, campaignsListInput(query));
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
              filters={query}
            />
          </section>
        );
      }}
    </RequireOrg>
  );
}
