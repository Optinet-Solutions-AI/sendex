"use client";

import { formatMicro } from "./format";
import type { EstimateView } from "./types";
import { Button } from "./ui";

function Cell({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="min-w-[5.5rem]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

/** Sticky footer: live counts from `estimateSend` and the Send button. */
export function EstimateFooter({
  estimate,
  loading,
  canSend,
  sending,
  onSend,
}: {
  estimate: EstimateView | null;
  loading: boolean;
  canSend: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  const n = (value: number | undefined) =>
    value === undefined ? "–" : value.toLocaleString("en-GB");
  return (
    <div
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-6 rounded border border-neutral-300 bg-white px-4 py-3 shadow-lg"
      data-testid="estimate-footer"
      aria-busy={loading}
    >
      <Cell label="Contacts" value={n(estimate?.contacts)} testId="footer-contacts" />
      <Cell label="SIDs" value={n(estimate?.sids)} testId="footer-sids" />
      <Cell label="Texts" value={n(estimate?.texts)} testId="footer-texts" />
      <Cell label="Links" value={n(estimate?.links)} testId="footer-links" />
      <Cell
        label="Test size"
        value={estimate?.sendAll ? "all" : n(estimate?.testSize)}
        testId="footer-test-size"
      />
      <Cell label="SMS" value={n(estimate?.smsCount)} testId="footer-sms" />
      <Cell
        label="Cost"
        value={estimate ? formatMicro(estimate.costMicro) : "–"}
        testId="footer-cost"
      />
      <div className="ml-auto flex items-center gap-3">
        {loading ? <span className="text-xs text-neutral-500">Updating…</span> : null}
        <Button
          variant="primary"
          onClick={onSend}
          disabled={!canSend || sending || loading || !estimate || estimate.smsCount === 0}
          data-testid="send-button"
        >
          {sending ? "Queuing…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
