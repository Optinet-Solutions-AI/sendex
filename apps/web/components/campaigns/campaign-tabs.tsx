"use client";

import { PillTabs } from "@sendex/ui";
import { BarChart3, FileText, ListChecks, Send } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { CampaignTab } from "./tabs";

const TABS = [
  { value: "status", label: "Status", icon: <ListChecks /> },
  { value: "logs", label: "Logs", icon: <FileText /> },
  { value: "analytics", label: "Analytics", icon: <BarChart3 /> },
  { value: "single", label: "Send Single", icon: <Send /> },
] as const satisfies readonly { value: CampaignTab; label: string; icon: ReactNode }[];

/** Status (the send form), Logs, Analytics and Send Single, as pills; the active one is in `?tab=`. */
export function CampaignTabs({
  active,
  panels,
}: {
  active: CampaignTab;
  panels: Record<CampaignTab, ReactNode>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (tab: CampaignTab) => {
    const next = new URLSearchParams(params.toString());
    if (tab === "status") next.delete("tab");
    else next.set("tab", tab);
    if (tab !== "logs") next.delete("logs");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return (
    <div>
      <PillTabs label="Campaign sections" value={active} tabs={TABS} onChange={go} />
      <div role="tabpanel" className="pt-4">
        {panels[active]}
      </div>
    </div>
  );
}
