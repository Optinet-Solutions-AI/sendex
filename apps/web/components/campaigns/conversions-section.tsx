import type { ConversionRow, ConversionStats } from "@sendex/db";
import { formatMicro, formatPer, formatPercent } from "./format";

/** The conversion breakdowns of a campaign (Analytics tab): totals, per sender id, per ad text. */

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
  rows: ConversionRow[];
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
              <th className="px-2 py-2 text-right">Leads</th>
              <th className="px-2 py-2 text-right">Lead rate</th>
              <th className="px-2 py-2 text-right">CPL</th>
              <th className="px-2 py-2 text-right">Sales</th>
              <th className="px-2 py-2 text-right">Sale rate</th>
              <th className="px-2 py-2 text-right">CPS</th>
              <th className="px-2 py-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-2 py-4 text-center text-neutral-500">
                  Nothing sent yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-neutral-100"
                  data-testid="conversion-row"
                >
                  <td className="max-w-md truncate px-2 py-1.5" title={row.label}>
                    {row.label}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.sent}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.leads}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatPercent(row.leadRate)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatPer(row.cplMicro)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.sales}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatPercent(row.saleRate)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatPer(row.cpsMicro)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatMicro(row.revenueMicro)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ConversionsSection({ stats }: { stats: ConversionStats | null }) {
  if (stats === null) return null;
  const c = stats.campaign;
  return (
    <section className="space-y-4" data-testid="conversions-section">
      <h3 className="text-sm font-semibold">Conversions</h3>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Leads" value={String(c.leads)} testId="conversions-leads" />
        <Stat label="Lead rate" value={formatPercent(c.leadRate)} />
        <Stat label="CPL" value={formatPer(c.cplMicro)} />
        <Stat label="Sales" value={String(c.sales)} testId="conversions-sales" />
        <Stat label="Sale rate" value={formatPercent(c.saleRate)} />
        <Stat label="CPS" value={formatPer(c.cpsMicro)} />
      </dl>
      <BreakdownTable
        title="By sender id"
        keyLabel="Sender id"
        rows={stats.senderIds}
        testId="conversions-by-sender"
      />
      <BreakdownTable
        title="By ad text"
        keyLabel="Text"
        rows={stats.adTexts}
        testId="conversions-by-text"
      />
    </section>
  );
}
