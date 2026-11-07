import { db, listCampaigns } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
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
            <PageHeader
              breadcrumb={[{ label: "SMS" }, { label: "Campaigns" }]}
              title="Campaigns"
              actions={<NewCampaignModal />}
            />
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
