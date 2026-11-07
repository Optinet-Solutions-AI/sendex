import { db, sendLog } from "@sendex/db";
import { CampaignsLog, type LogRowView } from "../../../../components/reports/campaigns-log";
import {
  LOG_PAGE_SIZE,
  logWindow,
  parseCampaignsLogQuery,
} from "../../../../lib/campaigns-log-params";
import type { SearchParams } from "../../../../lib/lists-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

/** The Campaigns Log (D4-05): daily sends per campaign, country, list and route. */
export default async function CampaignsLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseCampaignsLogQuery(await searchParams);
  const window = logWindow(query);
  return (
    <RequireOrg action="campaign.view">
      {async (ctx) => {
        const page = await sendLog(db(), ctx.organisationId, {
          ...window,
          countries: query.countries,
          page: query.page,
          pageSize: LOG_PAGE_SIZE,
        });
        const rows: LogRowView[] = page.rows.map((r) => ({
          day: r.day,
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          country: r.country,
          listName: r.listName,
          routeName: r.routeName,
          sent: r.sent,
          spendMicro: r.spendMicro.toString(),
          ctr: r.ctr,
          clicks: r.clicks,
          cpcMicro: r.cpcMicro === null ? null : r.cpcMicro.toString(),
          leads: r.leads,
          sales: r.sales,
        }));
        return (
          <CampaignsLog
            rows={rows}
            total={page.total}
            kpis={{
              ...page.kpis,
              spendMicro: page.kpis.spendMicro.toString(),
              cpcMicro: page.kpis.cpcMicro === null ? null : page.kpis.cpcMicro.toString(),
            }}
            query={query}
          />
        );
      }}
    </RequireOrg>
  );
}
