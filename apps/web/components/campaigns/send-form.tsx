"use client";

import { Button, Card, Toggle } from "@sendex/ui";
import { ChevronRight, RefreshCw, Send, Tag, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, useTransition } from "react";
import {
  estimateSendAction,
  sendCampaignAction,
  updateSendSettingsAction,
} from "../../app/(dashboard)/campaigns/actions";
import { AdTextsPanel } from "./ad-texts-panel";
import { AdvancedSettings } from "./advanced-settings";
import { ContextPanel, type ContextTab, SendSummary } from "./context-panel";
import { formatPricePerSms } from "./format";
import { LapsTable } from "./laps-table";
import { ListsPanel } from "./lists-panel";
import { OffersPanel } from "./offers-panel";
import { RoutesPanel } from "./routes-panel";
import { isoToLocalInput, localInputToIso, scheduleNote } from "./schedule";
import { SendBar } from "./send-bar";
import { SidGroupSelect, SidPanel } from "./sid-panel";
import type {
  CampaignView,
  EstimateView,
  LinkOption,
  ListOption,
  RoutePerformanceView,
  RouteView,
  SegmentOption,
  SidGroupView,
} from "./types";
import { ErrorText, inputClass } from "./ui";

export interface SendFormProps {
  campaign: CampaignView;
  sidGroups: SidGroupView[];
  lists: ListOption[];
  /** The organisation's segments (not templates, not global excludes) for the Segments section. */
  segmentOptions: SegmentOption[];
  links: LinkOption[];
  routes: RouteView[];
  /** Platform ranks and the organisation's own statistics per route, for the Routes tab. */
  performance?: RoutePerformanceView;
  /** Whether the current role may press Send (`campaign.send`). */
  canSend: boolean;
  /** Whether the role may flush lists (`list.flush`). */
  canFlush: boolean;
  /** The organisation balance in micro-EUR, for the balance check in the send bar. */
  balanceMicro: number;
}

/** A form row of the spec: label on the left, control on the right; clicking it opens its tab. */
function FormRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 border-b border-rule py-3 last:border-b-0">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * The "Send this campaign" card of the spec: the form on the left (Send Now, SIDs, Lists,
 * Offers, Ad Texts, Routes, Advanced Settings), the context panel on the right whose tab
 * follows the row you touch, and the dark send bar at the bottom. Persisted choices are saved
 * by their panels through server actions; the picked routes and "send all" go with the send.
 */
export function SendForm({
  campaign,
  sidGroups,
  lists,
  segmentOptions,
  links,
  routes,
  performance,
  canSend,
  canFlush,
  balanceMicro,
}: SendFormProps) {
  const router = useRouter();
  const id = useId();
  const [tab, setTab] = useState<ContextTab>("summary");
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [sendAll, setSendAll] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [estimate, setEstimate] = useState<EstimateView | null>(null);
  const [tick, setTick] = useState(0);
  const [estimating, startEstimate] = useTransition();
  const [sending, startSend] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sendNow, setSendNow] = useState(campaign.scheduledAt === null);
  const [local, setLocal] = useState(isoToLocalInput(campaign.scheduledAt, campaign.timezone));

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

  function saveSchedule(nextSendNow: boolean, nextLocal: string) {
    setError(null);
    const scheduledAt = nextSendNow ? null : localInputToIso(nextLocal, campaign.timezone);
    if (!nextSendNow && scheduledAt === null) {
      setError("Pick a start date and time");
      return;
    }
    startSave(async () => {
      const result = await updateSendSettingsAction({
        campaignId: campaign.id,
        testSize: campaign.testSize,
        contactReuse: campaign.contactReuse,
        sendNow: nextSendNow,
        ...(scheduledAt ? { scheduledAt } : {}),
      });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

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

  const picked = routes.filter((r) => routeIds.includes(r.id));
  const activeOffers = campaign.links.filter((l) => l.active).length;
  const activeTexts = campaign.adTexts.filter((t) => t.active).length;
  const rowButton =
    "flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-surface px-3 py-2 text-left text-sm hover:bg-neutral-50";

  return (
    <div className="space-y-6">
      <LapsTable campaign={campaign} canToggle={canSend} canFlush={canFlush} />
      <Card id="send-this-campaign" data-testid="send-form">
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Send className="h-4 w-4 text-navy" aria-hidden="true" /> Send this campaign
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh"
            onClick={onChanged}
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div
            className="border-b border-rule px-4 py-1 lg:border-r lg:border-b-0"
            data-testid="schedule-panel"
          >
            <FormRow label="Send Now">
              <div className="space-y-2">
                <Toggle
                  name="send-now"
                  label="Send Now"
                  labelHidden
                  hint="sends immediately"
                  checked={sendNow}
                  onCheckedChange={(next) => {
                    setSendNow(next);
                    if (next) saveSchedule(true, local);
                  }}
                  disabled={saving}
                />
                {!sendNow ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="datetime-local"
                        aria-label="Start time"
                        className={`${inputClass} w-auto`}
                        value={local}
                        onChange={(e) => setLocal(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => saveSchedule(false, local)}
                        disabled={saving}
                      >
                        Save start time
                      </Button>
                    </div>
                    <p className="text-xs text-muted">
                      {scheduleNote(campaign.country, campaign.timezone)}
                    </p>
                  </div>
                ) : null}
              </div>
            </FormRow>
            <FormRow label="SIDs">
              <SidGroupSelect
                campaign={campaign}
                groups={sidGroups}
                onChanged={onChanged}
                onFocusTab={() => setTab("sids")}
              />
            </FormRow>
            <FormRow label="Lists">
              <button
                type="button"
                className={rowButton}
                onClick={() => setTab("lists")}
                aria-label="Lists"
              >
                <span
                  className={
                    campaign.lists.length + campaign.segments.length === 0
                      ? "text-muted"
                      : "truncate"
                  }
                >
                  {campaign.lists.length + campaign.segments.length === 0
                    ? "Select lists or segments…"
                    : [
                        ...campaign.segments.map((seg) => `${seg.name} (segment)`),
                        ...campaign.lists.map((l) => l.name),
                      ].join(", ")}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              </button>
            </FormRow>
            <FormRow label="Offers">
              <button
                type="button"
                className={rowButton}
                onClick={() => setTab("offers")}
                aria-label="Offers"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Tag className="h-4 w-4 text-muted" aria-hidden="true" />
                  {activeOffers} active offer{activeOffers === 1 ? "" : "s"}
                </span>
                <ChevronRight className="h-4 w-4 text-muted" aria-hidden="true" />
              </button>
            </FormRow>
            <FormRow label="Ad Texts">
              <button
                type="button"
                className={rowButton}
                onClick={() => setTab("texts")}
                aria-label="Ad Texts"
              >
                <span>
                  {activeTexts} active text{activeTexts === 1 ? "" : "s"}
                </span>
                <ChevronRight className="h-4 w-4 text-muted" aria-hidden="true" />
              </button>
            </FormRow>
            <FormRow label="Routes">
              <button
                type="button"
                className={rowButton}
                onClick={() => setTab("routes")}
                aria-label="Routes"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  {picked.length === 0 ? (
                    <span className="text-muted">Select routes…</span>
                  ) : (
                    picked.map((r) => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1 rounded-full bg-navy-soft px-2 py-0.5 text-xs text-ink"
                      >
                        {r.platform ? `Route ${r.name}` : r.name}
                        <span className="font-mono text-muted">
                          {formatPricePerSms(r.priceMicro)}
                        </span>
                        <X
                          className="h-3 w-3 cursor-pointer text-muted hover:text-ink"
                          aria-label={`Remove ${r.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRouteIds(routeIds.filter((x) => x !== r.id));
                          }}
                        />
                      </span>
                    ))
                  )}
                </span>
                <span className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
                  {picked.length > 0 ? <span className="font-mono">{picked.length}</span> : null}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            </FormRow>
            <FormRow label="Advanced Settings" htmlFor={`${id}-advanced`}>
              <Toggle
                label="Advanced Settings"
                labelHidden
                checked={advancedOpen}
                onCheckedChange={setAdvancedOpen}
              />
            </FormRow>
            {advancedOpen ? (
              <div className="pb-3">
                <AdvancedSettings
                  campaign={campaign}
                  sendAll={sendAll}
                  onSendAllChange={setSendAll}
                  onChanged={onChanged}
                />
              </div>
            ) : null}
          </div>
          <ContextPanel
            tab={tab}
            onTabChange={setTab}
            panels={{
              summary: (
                <SendSummary
                  campaign={campaign}
                  routes={routes}
                  selectedRouteIds={routeIds}
                  sendAll={sendAll}
                />
              ),
              lists: (
                <ListsPanel
                  campaign={campaign}
                  lists={lists}
                  segmentOptions={segmentOptions}
                  canFlush={canFlush}
                  onChanged={onChanged}
                />
              ),
              offers: <OffersPanel campaign={campaign} links={links} onChanged={onChanged} />,
              texts: <AdTextsPanel campaign={campaign} onChanged={onChanged} />,
              sids: <SidPanel campaign={campaign} groups={sidGroups} onChanged={onChanged} />,
              routes: (
                <RoutesPanel
                  routes={routes}
                  selected={routeIds}
                  onChange={setRouteIds}
                  {...(performance ? { performance } : {})}
                />
              ),
            }}
          />
        </div>
        {error ? (
          <div className="px-4 pb-2">
            <ErrorText error={error} />
          </div>
        ) : null}
        <SendBar
          campaign={campaign}
          estimate={estimate}
          routeCount={routeIds.length}
          balanceMicro={balanceMicro}
          loading={estimating}
          canSend={canSend}
          sending={sending}
          onSend={send}
        />
      </Card>
    </div>
  );
}
