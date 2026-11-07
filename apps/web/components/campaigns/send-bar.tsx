"use client";

import { Button } from "@sendex/ui";
import { Send } from "lucide-react";
import { formatMicro } from "./format";
import type { CampaignView, EstimateView } from "./types";

/**
 * The first thing that blocks a send, in the spec's order: SID group, audience, text,
 * route, balance. Null when the setup is complete.
 */
export function sendBlocker(
  campaign: Pick<CampaignView, "sidGroup" | "lists" | "adTexts">,
  estimate: EstimateView | null,
  routeCount: number,
  balanceMicro: number | null,
): string | null {
  if (!campaign.sidGroup || campaign.sidGroup.activeCount === 0) {
    return "SID group with active sender IDs required";
  }
  if (campaign.lists.length === 0) return "Pick at least one list or segment";
  if (campaign.adTexts.filter((t) => t.active).length === 0) return "Add at least one ad text";
  if (routeCount === 0) return "Pick at least one route";
  if (estimate && estimate.smsCount === 0)
    return "Nothing to send: the lists have no contacts left";
  if (estimate && balanceMicro !== null && estimate.costMicro > balanceMicro) {
    return `Insufficient balance: the send needs ${formatMicro(estimate.costMicro)}`;
  }
  return null;
}

function Counter({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-neutral-400">
        {label}
      </span>
      <span className="font-mono text-sm font-medium text-white" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/**
 * The dark navy bar at the bottom of "Send this campaign": CONTACTS · SIDS · TEXTS · OFFERS ·
 * TEST SIZE · SMS · COST, the amber validation message, and Send (disabled until valid).
 */
export function SendBar({
  campaign,
  estimate,
  routeCount,
  balanceMicro,
  loading,
  canSend,
  sending,
  onSend,
}: {
  campaign: CampaignView;
  estimate: EstimateView | null;
  routeCount: number;
  balanceMicro: number | null;
  loading: boolean;
  canSend: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  const n = (value: number | undefined) =>
    value === undefined ? "–" : value.toLocaleString("en-GB");
  const blocker = sendBlocker(campaign, estimate, routeCount, balanceMicro);
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-b-lg bg-rail px-4 py-3"
      data-testid="estimate-footer"
      aria-busy={loading}
    >
      <Counter label="Contacts" value={n(estimate?.contacts)} testId="footer-contacts" />
      <Counter label="SIDs" value={n(estimate?.sids)} testId="footer-sids" />
      <Counter label="Texts" value={n(estimate?.texts)} testId="footer-texts" />
      <Counter label="Offers" value={n(estimate?.links)} testId="footer-links" />
      <Counter
        label="Test size"
        value={estimate?.sendAll ? "all" : n(estimate?.testSize)}
        testId="footer-test-size"
      />
      <Counter label="SMS" value={n(estimate?.smsCount)} testId="footer-sms" />
      <Counter
        label="Cost"
        value={estimate ? `~${formatMicro(estimate.costMicro)}` : "–"}
        testId="footer-cost"
      />
      <div className="ml-auto flex items-center gap-3">
        {loading ? <span className="text-xs text-neutral-400">Updating…</span> : null}
        {blocker && !loading ? (
          <span className="text-xs text-amber-300" data-testid="send-blocker">
            {blocker}
          </span>
        ) : null}
        <Button
          onClick={onSend}
          disabled={!canSend || sending || loading || !estimate || blocker !== null}
          data-testid="send-button"
          className="bg-white text-rail hover:bg-neutral-200"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {sending ? "Queuing…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
