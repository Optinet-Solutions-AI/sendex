"use client";

import { type ReactNode, useState } from "react";

const TABS = ["Status", "Logs", "Analytics", "Send Single"] as const;
export type CampaignTab = (typeof TABS)[number];

/** Status (the send form), Logs (audit), Analytics and Send Single placeholders. */
export function CampaignTabs({ panels }: { panels: Record<CampaignTab, ReactNode> }) {
  const [active, setActive] = useState<CampaignTab>("Status");
  return (
    <div>
      <div
        role="tablist"
        aria-label="Campaign sections"
        className="flex gap-1 border-b border-neutral-200"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active === tab}
            onClick={() => setActive(tab)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              active === tab
                ? "border-neutral-900 font-medium text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-4">
        {panels[active]}
      </div>
    </div>
  );
}
