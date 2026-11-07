"use client";

import { countryName, flagEmoji } from "@sendex/core";
import { PillTabs } from "@sendex/ui";
import type { ReactNode } from "react";
import { formatDateTime } from "./format";
import type { CampaignView, RouteView } from "./types";

export const CONTEXT_TABS = [
  { value: "summary", label: "Summary" },
  { value: "lists", label: "Lists" },
  { value: "offers", label: "Offers" },
  { value: "texts", label: "Ad Texts" },
  { value: "sids", label: "SIDs" },
  { value: "routes", label: "Routes" },
] as const;
export type ContextTab = (typeof CONTEXT_TABS)[number]["value"];

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

/** The Summary tab: the "Send summary" key/value table and the hint under it. */
export function SendSummary({
  campaign,
  routes,
  selectedRouteIds,
  sendAll,
}: {
  campaign: CampaignView;
  routes: RouteView[];
  selectedRouteIds: readonly string[];
  sendAll: boolean;
}) {
  const picked = routes.filter((r) => selectedRouteIds.includes(r.id));
  const activeTexts = campaign.adTexts.filter((t) => t.active).length;
  const activeOffers = campaign.links.filter((l) => l.active).length;
  const schedule = campaign.scheduledAt
    ? `${formatDateTime(campaign.scheduledAt, campaign.timezone)} (${campaign.timezone})`
    : "Send now";
  return (
    <div data-testid="summary-panel">
      <h4 className="mb-1 text-sm font-semibold text-ink">Send summary</h4>
      <dl className="divide-y divide-rule">
        <Row label="Campaign" value={campaign.name} />
        <Row
          label="Country"
          value={`${flagEmoji(campaign.country)} ${countryName(campaign.country)}`}
        />
        <Row
          label="Audiences"
          value={
            campaign.lists.length + campaign.segments.length === 0
              ? "none selected"
              : [
                  campaign.lists.length > 0
                    ? `${campaign.lists.length} list${campaign.lists.length === 1 ? "" : "s"}`
                    : null,
                  campaign.segments.length > 0
                    ? `${campaign.segments.length} segment${campaign.segments.length === 1 ? "" : "s"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")
          }
        />
        <Row
          label="Routes"
          value={picked.length === 0 ? "none selected" : `${picked.length} selected`}
        />
        <Row label="Active ad texts" value={String(activeTexts)} />
        <Row label="Active offers" value={String(activeOffers)} />
        <Row
          label="Sender IDs"
          value={
            campaign.sidGroup
              ? `${campaign.sidGroup.name} (${campaign.sidGroup.activeCount} active)`
              : "none"
          }
        />
        <Row label="Mode" value={sendAll ? "Send all" : `Test ${campaign.testSize} per lap`} />
        <Row label="Schedule" value={schedule} />
      </dl>
      <p className="mt-3 text-xs text-muted">
        Pick lists, offers, ad texts and routes on the left — this panel shows the matching details
        as you go.
      </p>
    </div>
  );
}

/** The right-hand panel: pill tabs that the form rows on the left switch to. */
export function ContextPanel({
  tab,
  onTabChange,
  panels,
}: {
  tab: ContextTab;
  onTabChange: (tab: ContextTab) => void;
  panels: Record<ContextTab, ReactNode>;
}) {
  return (
    <aside className="flex min-w-0 flex-col" data-testid="context-panel">
      <div className="border-b border-rule px-4 py-3">
        <PillTabs
          label="Send panel sections"
          value={tab}
          tabs={CONTEXT_TABS}
          onChange={onTabChange}
        />
      </div>
      <div role="tabpanel" className="p-4">
        {panels[tab]}
      </div>
    </aside>
  );
}
