import { countryName, flagEmoji } from "@sendex/core";
import { campaignTotals, formatDateTime, formatMicro, formatPer, formatPercent } from "./format";
import type { CampaignView, ResultTotalsView } from "./types";
import { StatusBadge } from "./ui";

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white px-3 py-2">
      <div className="text-[11px] font-medium uppercase text-neutral-500">{label}</div>
      <div className="text-base font-semibold" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

/**
 * Name, status, country, created date, the totals row and the sending progress bar. With
 * `totals` from `campaignResults` the row also shows delivered, failed and CPC; without it
 * the totals are summed from the campaign's laps.
 */
export function CampaignHeader({
  campaign,
  totals: results,
}: {
  campaign: CampaignView;
  totals?: ResultTotalsView;
}) {
  const totals = results ?? campaignTotals(campaign.laps);
  const contacts = campaign.lists.reduce((sum, l) => sum + l.available, 0);
  const planned = campaign.laps.reduce((sum, l) => sum + l.testSize, 0);
  const target = planned > 0 ? planned : contacts;
  const progress = target > 0 ? Math.min(100, Math.round((totals.sent / target) * 100)) : 0;
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold" data-testid="campaign-name">
          {campaign.name}
        </h1>
        <StatusBadge status={campaign.status} />
        <span className="text-sm text-neutral-600">
          {flagEmoji(campaign.country)} {countryName(campaign.country)} · {campaign.timezone}
        </span>
        <span className="text-sm text-neutral-500">
          Created {formatDateTime(campaign.createdAt, campaign.timezone)}
        </span>
      </div>
      <div
        className="grid grid-cols-4 gap-2 md:grid-cols-6 xl:grid-cols-12"
        data-testid="campaign-totals"
      >
        <Stat label="Sent" value={String(totals.sent)} testId="total-sent" />
        <Stat label="Delivered" value={String(totals.delivered)} testId="total-delivered" />
        <Stat label="Failed" value={String(totals.failed)} testId="total-failed" />
        <Stat
          label="Delivery"
          value={formatPercent(totals.deliveryRate)}
          testId="total-delivery-rate"
        />
        <Stat label="Clicks" value={String(totals.clicks)} testId="total-clicks" />
        <Stat label="CTR" value={formatPercent(totals.ctr)} testId="total-ctr" />
        <Stat label="Cost" value={formatMicro(totals.costMicro)} testId="total-cost" />
        <Stat label="CPC" value={formatPer(totals.cpcMicro)} testId="total-cpc" />
        <Stat label="Leads" value={String(totals.leads)} testId="total-leads" />
        <Stat label="CPL" value={formatPer(totals.cplMicro)} testId="total-cpl" />
        <Stat label="Sales" value={String(totals.sales)} testId="total-sales" />
        <Stat label="CPS" value={formatPer(totals.cpsMicro)} testId="total-cps" />
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs text-neutral-600">
          <span>Sending progress</span>
          <span data-testid="sending-progress">
            {totals.sent} / {target} contacts
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded bg-neutral-200"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Sending progress"
        >
          <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </header>
  );
}
