"use client";

import { countryName, flagEmoji } from "@sendex/core";
import { useState } from "react";
import { formatDateTime, formatPricePerSms } from "./format";
import type { CampaignView, RouteView } from "./types";

const TABS = ["Summary", "Lists", "Links", "Ad Texts", "SIDs", "Routes"] as const;
type Tab = (typeof TABS)[number];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Empty({ what }: { what: string }) {
  return <p className="text-xs text-neutral-500">No {what} selected.</p>;
}

/** Right-hand panel: what the campaign will send, tab by tab. */
export function SummaryPanel({
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
  const [tab, setTab] = useState<Tab>("Summary");
  const picked = routes.filter((r) => selectedRouteIds.includes(r.id));
  const activeTexts = campaign.adTexts.filter((t) => t.active);
  const activeLinks = campaign.links.filter((l) => l.active);
  const schedule = campaign.scheduledAt
    ? `${formatDateTime(campaign.scheduledAt, campaign.timezone)} (${campaign.timezone})`
    : "Send now";

  return (
    <aside className="rounded border border-neutral-200 bg-white" data-testid="summary-panel">
      <div
        role="tablist"
        aria-label="Summary sections"
        className="flex flex-wrap border-b border-neutral-200"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs ${
              tab === t ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="p-4">
        {tab === "Summary" ? (
          <dl className="divide-y divide-neutral-100">
            <Row label="Campaign" value={campaign.name} />
            <Row
              label="Country"
              value={`${flagEmoji(campaign.country)} ${countryName(campaign.country)}`}
            />
            <Row
              label="Audiences"
              value={`${campaign.lists.length} list${campaign.lists.length === 1 ? "" : "s"}`}
            />
            <Row label="Routes" value={picked.map((r) => r.name).join(", ") || "none"} />
            <Row label="Active texts" value={String(activeTexts.length)} />
            <Row label="Active links" value={String(activeLinks.length)} />
            <Row
              label="Sender ids"
              value={
                campaign.sidGroup
                  ? `${campaign.sidGroup.name} (${campaign.sidGroup.activeCount})`
                  : "none"
              }
            />
            <Row label="Mode" value={sendAll ? "Send all" : `Test ${campaign.testSize} per lap`} />
            <Row label="Schedule" value={schedule} />
          </dl>
        ) : null}
        {tab === "Lists" ? (
          campaign.lists.length === 0 ? (
            <Empty what="lists" />
          ) : (
            <ul className="space-y-1 text-sm">
              {campaign.lists.map((l) => (
                <li key={l.id} className="flex justify-between">
                  <span>{l.name}</span>
                  <span className="text-neutral-500">
                    {l.available.toLocaleString("en-GB")} left
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {tab === "Links" ? (
          campaign.links.length === 0 ? (
            <Empty what="links" />
          ) : (
            <ul className="space-y-1 text-sm">
              {campaign.links.map((l) => (
                <li key={l.id} className={l.active ? "" : "text-neutral-400 line-through"}>
                  {l.name} <span className="font-mono text-xs text-neutral-500">{l.url}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {tab === "Ad Texts" ? (
          campaign.adTexts.length === 0 ? (
            <Empty what="texts" />
          ) : (
            <ol className="list-decimal space-y-1 pl-4 text-sm">
              {campaign.adTexts.map((t) => (
                <li key={t.id} className={t.active ? "" : "text-neutral-400 line-through"}>
                  {t.text}{" "}
                  <span className="text-xs text-neutral-500">
                    ({t.parts} part{t.parts === 1 ? "" : "s"})
                  </span>
                </li>
              ))}
            </ol>
          )
        ) : null}
        {tab === "SIDs" ? (
          campaign.sidGroup ? (
            <div className="text-sm">
              <p className="mb-1 font-medium">{campaign.sidGroup.name}</p>
              <p className="font-mono text-xs text-neutral-600">
                {campaign.sidGroup.senderIds
                  .filter((s) => s.active)
                  .map((s) => s.value)
                  .join(", ") || "no active sender ids"}
              </p>
            </div>
          ) : (
            <Empty what="sender id group" />
          )
        ) : null}
        {tab === "Routes" ? (
          picked.length === 0 ? (
            <Empty what="routes" />
          ) : (
            <ul className="space-y-1 text-sm">
              {picked.map((r) => (
                <li key={r.id} className="flex justify-between">
                  <span>{r.name}</span>
                  <span className="text-neutral-500">{formatPricePerSms(r.priceMicro)}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </aside>
  );
}
