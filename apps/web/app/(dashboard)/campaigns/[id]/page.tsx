import { can, shortLinkLength } from "@sendex/core";
import {
  campaignResults,
  clickStats,
  conversionStats,
  db,
  getBalanceMicro,
  getCampaign,
  listAuditLog,
  listCampaignMessages,
  listLinks,
  listSegments,
  listSidGroups,
  listsForCountry,
  orderedRoutesForCountry,
  routePerformance,
  sidGroupStats,
} from "@sendex/db";
import { notFound } from "next/navigation";
import { AdTextsPanel } from "../../../../components/campaigns/ad-texts-panel";
import { AnalyticsSection } from "../../../../components/campaigns/analytics-section";
import { CampaignControls } from "../../../../components/campaigns/campaign-controls";
import { CampaignHeader } from "../../../../components/campaigns/campaign-header";
import { CampaignTabs } from "../../../../components/campaigns/campaign-tabs";
import { ClicksSection } from "../../../../components/campaigns/clicks-section";
import { ConversionsSection } from "../../../../components/campaigns/conversions-section";
import { LogsTab } from "../../../../components/campaigns/logs-tab";
import { OffersPanel } from "../../../../components/campaigns/offers-panel";
import { SendForm } from "../../../../components/campaigns/send-form";
import { SidPanel } from "../../../../components/campaigns/sid-panel";
import { isCampaignTab, isLogsSubTab } from "../../../../components/campaigns/tabs";
import { SendSingleForm } from "../../../../components/routes/send-single-dialog";
import {
  toAuditView,
  toCampaignView,
  toLinkOption,
  toListOption,
  toMessagesView,
  toResultsView,
  toRoutePerformanceView,
  toRouteView,
  toSidGroupView,
} from "../../../../lib/campaign-views";
import type { SearchParams } from "../../../../lib/lists-params";
import { RequireOrg } from "../../require-org";
import { LogPanelRefresh } from "./log-panel-refresh";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v ?? null;
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const tabParam = first(query.tab);
  const tab = isCampaignTab(tabParam) ? tabParam : "status";
  const logsParam = first(query.logs);
  const logs = isLogsSubTab(logsParam) ? logsParam : "actions";
  const messagePage = Math.max(1, Number.parseInt(first(query.mpage) ?? "1", 10) || 1);

  return (
    <RequireOrg action="campaign.view">
      {async (ctx) => {
        const database = db();
        const detail = await getCampaign(database, ctx.organisationId, id);
        if (!detail) notFound();
        const [
          sidGroups,
          lists,
          links,
          routes,
          audit,
          conversions,
          resultRows,
          clicks,
          messages,
          balanceMicro,
          performance,
          segmentListing,
        ] = await Promise.all([
          listSidGroups(database, ctx.organisationId, detail.country),
          listsForCountry(database, ctx.organisationId, detail.country),
          listLinks(database, ctx.organisationId),
          orderedRoutesForCountry(database, ctx.organisationId, detail.country),
          listAuditLog(database, ctx.organisationId, { targetType: "campaign", targetId: id }),
          conversionStats(database, ctx.organisationId, id),
          campaignResults(database, ctx.organisationId, id),
          clickStats(database, ctx.organisationId, id),
          listCampaignMessages(database, ctx.organisationId, id, { page: messagePage }),
          getBalanceMicro(database, ctx.organisationId),
          routePerformance(database, ctx.organisationId, detail.country),
          listSegments(database, ctx.organisationId, { tab: "all" }),
        ]);
        const segmentOptions = segmentListing.rows
          .filter((seg) => !seg.isTemplate && !seg.globalExclude)
          .map((seg) => ({
            id: seg.id,
            name: seg.name,
            summary: seg.summary,
            size: seg.size,
            good: seg.good,
          }));
        const stats = await sidGroupStats(
          database,
          ctx.organisationId,
          sidGroups.map((g) => g.id),
        );
        const statsById = new Map(stats.map((s) => [s.groupId, s]));
        const groups = sidGroups.map((g) => toSidGroupView(g, statsById.get(g.id)));
        const linkLength = shortLinkLength(process.env.LINKS_BASE_URL);
        const campaign = toCampaignView(
          detail,
          detail.sidGroup ? statsById.get(detail.sidGroup.id) : undefined,
          linkLength,
        );
        const results = resultRows ? toResultsView(resultRows) : null;
        const canSend = can(ctx.role, "campaign.send");
        const canEdit = can(ctx.role, "campaign.create");
        return (
          <section className="space-y-6">
            <CampaignHeader
              campaign={campaign}
              canEdit={canEdit}
              {...(results ? { totals: results.totals } : {})}
            />
            <CampaignControls
              campaign={campaign}
              canStop={can(ctx.role, "campaign.stop")}
              canSend={canSend}
            />
            <CampaignTabs
              active={tab}
              panels={{
                status: (
                  <SendForm
                    campaign={campaign}
                    sidGroups={groups}
                    lists={lists.map(toListOption)}
                    segmentOptions={segmentOptions}
                    links={links.map(toLinkOption)}
                    routes={routes.map(toRouteView)}
                    performance={toRoutePerformanceView(performance)}
                    canSend={canSend}
                    canFlush={can(ctx.role, "list.flush")}
                    balanceMicro={Number(balanceMicro)}
                    linkLength={linkLength}
                  />
                ),
                logs: (
                  <LogsTab
                    campaign={campaign}
                    active={logs}
                    audit={audit.map(toAuditView)}
                    messages={toMessagesView(messages)}
                    panels={{
                      adtexts: (
                        <LogPanelRefresh>
                          {(onChanged) => (
                            <AdTextsPanel
                              campaign={campaign}
                              linkLength={linkLength}
                              onChanged={onChanged}
                            />
                          )}
                        </LogPanelRefresh>
                      ),
                      offers: (
                        <LogPanelRefresh>
                          {(onChanged) => (
                            <OffersPanel
                              campaign={campaign}
                              links={links.map(toLinkOption)}
                              onChanged={onChanged}
                            />
                          )}
                        </LogPanelRefresh>
                      ),
                      sids: (
                        <LogPanelRefresh>
                          {(onChanged) => (
                            <SidPanel campaign={campaign} groups={groups} onChanged={onChanged} />
                          )}
                        </LogPanelRefresh>
                      ),
                    }}
                  />
                ),
                analytics: (
                  <div className="space-y-6">
                    {results ? (
                      <AnalyticsSection results={results} timezone={campaign.timezone} />
                    ) : null}
                    <ClicksSection stats={clicks} />
                    <ConversionsSection stats={conversions} />
                  </div>
                ),
                single: (
                  <div className="max-w-2xl space-y-3">
                    <p className="text-sm text-muted">
                      Send one message through your routes to a number you control. The SMS cost
                      will be charged.
                    </p>
                    <SendSingleForm mode="single" country={detail.country} />
                  </div>
                ),
              }}
            />
          </section>
        );
      }}
    </RequireOrg>
  );
}
