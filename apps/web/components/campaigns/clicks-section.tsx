import { FORMULAS } from "@sendex/core";
import type { ClickRow, ClickStats } from "@sendex/db";
import { Explained } from "@sendex/ui";
import type { ReactNode } from "react";
import { type Explanation, explainCostPer, explainRate, LOCAL_FORMULAS } from "./explain";
import { Figure } from "./figure";
import { formatMicro, formatPer, formatPercent } from "./format";

/**
 * Clicks, CTR and CPC of a campaign (Analytics tab): totals, then per route (lap), sender
 * id, ad text and link. One click per message at most; see docs/using/campaign-results.md.
 */

function Stat({
  label,
  value,
  testId,
  explanation,
}: {
  label: string;
  value: string;
  testId?: string;
  /** A computed figure explains itself on hover (D5-20): the label with the formula, the value with the working. */
  explanation?: Explanation;
}) {
  return (
    <div className="rounded border border-neutral-200 bg-white px-3 py-2">
      <dt className="text-xs uppercase text-neutral-500">
        <Explained formula={explanation?.formula}>{label}</Explained>
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums" data-testid={testId}>
        {explanation ? <Figure explanation={explanation}>{value}</Figure> : value}
      </dd>
    </div>
  );
}

/** A right-aligned header; a computed column's label explains itself on hover. */
function Th({ formula, children }: { formula?: string; children: ReactNode }) {
  return (
    <th className="px-2 py-2 text-right">
      <Explained formula={formula}>{children}</Explained>
    </th>
  );
}

function BreakdownTable({
  title,
  keyLabel,
  rows,
  testId,
  perLap = false,
}: {
  title: string;
  keyLabel: string;
  rows: ClickRow[];
  testId: string;
  /** Rows are laps (their own cost), not groups of messages (cost shared out from the laps). */
  perLap?: boolean;
}) {
  const costFormula = perLap ? LOCAL_FORMULAS.lapCost : LOCAL_FORMULAS.splitCost;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm" data-testid={testId}>
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-2">{keyLabel}</th>
              <Th>Sent</Th>
              <Th>Delivered</Th>
              <Th formula={FORMULAS.deliveryRate}>Delivery</Th>
              <Th formula={FORMULAS.clicks}>Clicks</Th>
              <Th formula={FORMULAS.ctr}>CTR</Th>
              <Th formula={costFormula}>Cost</Th>
              <Th formula={FORMULAS.cpc}>CPC</Th>
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
                    <Figure
                      explanation={explainRate(
                        "deliveryRate",
                        row.delivered,
                        row.sent,
                        row.deliveryRate,
                      )}
                    >
                      {formatPercent(row.deliveryRate)}
                    </Figure>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.clicks}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Figure explanation={explainRate("ctr", row.clicks, row.sent, row.ctr)}>
                      {formatPercent(row.ctr)}
                    </Figure>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Explained formula={costFormula}>{formatMicro(row.costMicro)}</Explained>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Figure
                      explanation={explainCostPer("cpc", row.costMicro, row.clicks, row.cpcMicro)}
                    >
                      {formatPer(row.cpcMicro)}
                    </Figure>
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

export function ClicksSection({ stats }: { stats: ClickStats | null }) {
  if (stats === null) return null;
  const c = stats.campaign;
  return (
    <section className="space-y-4" data-testid="clicks-section">
      <h3 className="text-sm font-semibold">Clicks</h3>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Delivered" value={String(c.delivered)} testId="clicks-delivered" />
        <Stat
          label="Delivery"
          value={formatPercent(c.deliveryRate)}
          explanation={explainRate("deliveryRate", c.delivered, c.sent, c.deliveryRate)}
        />
        <Stat
          label="Clicks"
          value={String(c.clicks)}
          testId="clicks-total"
          explanation={{ formula: FORMULAS.clicks }}
        />
        <Stat
          label="CTR"
          value={formatPercent(c.ctr)}
          testId="clicks-ctr"
          explanation={explainRate("ctr", c.clicks, c.sent, c.ctr)}
        />
        <Stat
          label="CPC"
          value={formatPer(c.cpcMicro)}
          testId="clicks-cpc"
          explanation={explainCostPer("cpc", c.costMicro, c.clicks, c.cpcMicro)}
        />
        <Stat
          label="All redirects"
          value={String(c.rawClicks)}
          testId="clicks-raw"
          explanation={{ formula: LOCAL_FORMULAS.rawClicks }}
        />
      </dl>
      <BreakdownTable
        title="By route"
        keyLabel="Route"
        rows={stats.laps}
        testId="clicks-by-lap"
        perLap
      />
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
