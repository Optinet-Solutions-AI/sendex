import type { ClickRow, ClickStats } from "@sendex/db";
import { formatMicro, formatPer, formatPercent } from "./format";

/**
 * Clicks, CTR and CPC of a campaign (Analytics tab): totals, then per route (lap), sender
 * id, ad text and link. One click per message at most; see docs/using/campaign-results.md.
 */

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white px-3 py-2">
      <dt className="text-xs uppercase text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function BreakdownTable({
  title,
  keyLabel,
  rows,
  testId,
}: {
  title: string;
  keyLabel: string;
  rows: ClickRow[];
  testId: string;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm" data-testid={testId}>
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-2">{keyLabel}</th>
              <th className="px-2 py-2 text-right">Sent</th>
              <th className="px-2 py-2 text-right">Delivered</th>
              <th className="px-2 py-2 text-right">Delivery</th>
              <th className="px-2 py-2 text-right">Clicks</th>
              <th className="px-2 py-2 text-right">CTR</th>
              <th className="px-2 py-2 text-right">Cost</th>
              <th className="px-2 py-2 text-right">CPC</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-neutral-500">
                  Nothing sent yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key} className="border-t border-neutral-100" data-testid="click-row">
                  <td className="max-w-md truncate px-2 py-1.5" title={row.label}>
                    {row.label}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.sent}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.delivered}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatPercent(row.deliveryRate)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.clicks}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatPercent(row.ctr)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatMicro(row.costMicro)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatPer(row.cpcMicro)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ClicksSection({ stats }: { stats: ClickStats | null }) {
  if (stats === null) return null;
  const c = stats.campaign;
  return (
    <section className="space-y-4" data-testid="clicks-section">
      <h3 className="text-sm font-semibold">Clicks</h3>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Delivered" value={String(c.delivered)} testId="clicks-delivered" />
        <Stat label="Delivery" value={formatPercent(c.deliveryRate)} />
        <Stat label="Clicks" value={String(c.clicks)} testId="clicks-total" />
        <Stat label="CTR" value={formatPercent(c.ctr)} testId="clicks-ctr" />
        <Stat label="CPC" value={formatPer(c.cpcMicro)} testId="clicks-cpc" />
        <Stat label="All redirects" value={String(c.rawClicks)} testId="clicks-raw" />
      </dl>
      <BreakdownTable title="By route" keyLabel="Route" rows={stats.laps} testId="clicks-by-lap" />
      <BreakdownTable
        title="By sender id"
        keyLabel="Sender id"
        rows={stats.senderIds}
        testId="clicks-by-sender"
      />
      <BreakdownTable
        title="By ad text"
        keyLabel="Text"
        rows={stats.adTexts}
        testId="clicks-by-text"
      />
      <BreakdownTable title="By link" keyLabel="Link" rows={stats.links} testId="clicks-by-link" />
    </section>
  );
}
