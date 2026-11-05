import { can } from "@sendex/core";
import {
  conversionStats,
  db,
  getCampaign,
  listAuditLog,
  listLinks,
  listSidGroups,
  listsForCountry,
  routesForCountry,
} from "@sendex/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignControls } from "../../../../components/campaigns/campaign-controls";
import { CampaignHeader } from "../../../../components/campaigns/campaign-header";
import { CampaignTabs } from "../../../../components/campaigns/campaign-tabs";
import { ConversionsSection } from "../../../../components/campaigns/conversions-section";
import { formatDateTime } from "../../../../components/campaigns/format";
import { SendForm } from "../../../../components/campaigns/send-form";
import type { AuditView } from "../../../../components/campaigns/types";
import {
  toAuditView,
  toCampaignView,
  toLinkOption,
  toListOption,
  toRouteView,
  toSidGroupView,
} from "../../../../lib/campaign-views";
import { RequireOrg } from "../../require-org";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function LogsTab({ entries, timezone }: { entries: AuditView[]; timezone: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500">Nothing logged for this campaign yet.</p>;
  }
  return (
    <table className="w-full text-sm" data-testid="logs-table">
      <thead className="text-left text-xs uppercase text-neutral-500">
        <tr>
          <th className="py-1 pr-3">When</th>
          <th className="py-1 pr-3">Action</th>
          <th className="py-1">Details</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-t border-neutral-100 align-top">
            <td className="whitespace-nowrap py-1.5 pr-3 text-neutral-600">
              {formatDateTime(e.createdAt, timezone)}
            </td>
            <td className="py-1.5 pr-3 font-mono text-xs">{e.action}</td>
            <td className="py-1.5 font-mono text-xs text-neutral-600">
              {e.details ? JSON.stringify(e.details) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  return (
    <RequireOrg action="campaign.view">
      {async (ctx) => {
        const database = db();
        const detail = await getCampaign(database, ctx.organisationId, id);
        if (!detail) notFound();
        const [sidGroups, lists, links, routes, audit, conversions] = await Promise.all([
          listSidGroups(database, ctx.organisationId, detail.country),
          listsForCountry(database, ctx.organisationId, detail.country),
          listLinks(database, ctx.organisationId),
          routesForCountry(database, ctx.organisationId, detail.country),
          listAuditLog(database, ctx.organisationId, { targetType: "campaign", targetId: id }),
          conversionStats(database, ctx.organisationId, id),
        ]);
        const campaign = toCampaignView(detail);
        return (
          <section className="space-y-6">
            <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
              <Link href="/campaigns" className="hover:underline">
                Campaigns
              </Link>{" "}
              / {campaign.name}
            </nav>
            <CampaignHeader campaign={campaign} />
            <CampaignControls
              campaign={campaign}
              canStop={can(ctx.role, "campaign.stop")}
              canSend={can(ctx.role, "campaign.send")}
            />
            <CampaignTabs
              panels={{
                Status: (
                  <SendForm
                    campaign={campaign}
                    sidGroups={sidGroups.map(toSidGroupView)}
                    lists={lists.map(toListOption)}
                    links={links.map(toLinkOption)}
                    routes={routes.map(toRouteView)}
                    canSend={can(ctx.role, "campaign.send")}
                  />
                ),
                Logs: <LogsTab entries={audit.map(toAuditView)} timezone={campaign.timezone} />,
                Analytics: (
                  <div className="space-y-6">
                    <ConversionsSection stats={conversions} />
                    <p className="text-sm text-neutral-500">
                      Click and route ranking charts arrive with the analytics card.
                    </p>
                  </div>
                ),
                "Send Single": (
                  <p className="text-sm text-neutral-500">
                    Sending a single test message to one number arrives with the sending engine.
                  </p>
                ),
              }}
            />
          </section>
        );
      }}
    </RequireOrg>
  );
}
