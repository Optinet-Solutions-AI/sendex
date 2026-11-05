"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { estimateSendAction, sendCampaignAction } from "../../app/(dashboard)/campaigns/actions";
import { AdTextsPanel } from "./ad-texts-panel";
import { AdvancedSettings } from "./advanced-settings";
import { EstimateFooter } from "./estimate-footer";
import { LapsTable } from "./laps-table";
import { LinksPanel } from "./links-panel";
import { ListsPanel } from "./lists-panel";
import { RoutesPanel } from "./routes-panel";
import { SchedulePanel } from "./schedule-panel";
import { SidPanel } from "./sid-panel";
import { SummaryPanel } from "./summary-panel";
import type {
  CampaignView,
  EstimateView,
  LinkOption,
  ListOption,
  RouteView,
  SidGroupView,
} from "./types";
import { ErrorText } from "./ui";

export interface SendFormProps {
  campaign: CampaignView;
  sidGroups: SidGroupView[];
  lists: ListOption[];
  links: LinkOption[];
  routes: RouteView[];
  /** Whether the current role may press Send (`campaign.send`). */
  canSend: boolean;
}

/**
 * The Status tab: two columns like SMS Edge (settings left, summary right), the live estimate
 * footer and, once sent, the laps table. Persisted choices (lists, sender ids, texts, links,
 * schedule, test size, reuse) are saved by their panels through server actions; the picked
 * routes and "send all" live here and go with the send.
 */
export function SendForm({ campaign, sidGroups, lists, links, routes, canSend }: SendFormProps) {
  const router = useRouter();
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [sendAll, setSendAll] = useState(false);
  const [estimate, setEstimate] = useState<EstimateView | null>(null);
  const [tick, setTick] = useState(0);
  const [estimating, startEstimate] = useTransition();
  const [sending, startSend] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onChanged = useCallback(() => {
    router.refresh();
    setTick((t) => t + 1);
  }, [router]);

  // Re-estimate whenever the picked routes, the mode or any persisted part of the campaign changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the signal that a panel saved something.
  useEffect(() => {
    startEstimate(async () => {
      const result = await estimateSendAction({ campaignId: campaign.id, routeIds, sendAll });
      if (result.ok) {
        setEstimate(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [campaign.id, campaign.updatedAt, routeIds, sendAll, tick]);

  function send() {
    setError(null);
    startSend(async () => {
      const result = await sendCampaignAction({ campaignId: campaign.id, routeIds, sendAll });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <SchedulePanel campaign={campaign} onChanged={onChanged} />
          <SidPanel campaign={campaign} groups={sidGroups} onChanged={onChanged} />
          <ListsPanel campaign={campaign} lists={lists} onChanged={onChanged} />
          <LinksPanel campaign={campaign} links={links} onChanged={onChanged} />
          <AdTextsPanel campaign={campaign} onChanged={onChanged} />
          <RoutesPanel routes={routes} selected={routeIds} onChange={setRouteIds} />
          <AdvancedSettings
            campaign={campaign}
            sendAll={sendAll}
            onSendAllChange={setSendAll}
            onChanged={onChanged}
          />
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <SummaryPanel
            campaign={campaign}
            routes={routes}
            selectedRouteIds={routeIds}
            sendAll={sendAll}
          />
        </div>
      </div>
      <ErrorText error={error} />
      <EstimateFooter
        estimate={estimate}
        loading={estimating}
        canSend={canSend}
        sending={sending}
        onSend={send}
      />
      <LapsTable laps={campaign.laps} timezone={campaign.timezone} />
    </div>
  );
}
