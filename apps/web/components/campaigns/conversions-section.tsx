import { FORMULAS } from "@sendex/core";
import type { ConversionRow, ConversionStats } from "@sendex/db";
import { Explained } from "@sendex/ui";
import type { ReactNode } from "react";
import {
  type Explanation,
  explainCostPer,
  explainRate,
  explainRevenue,
  LOCAL_FORMULAS,
} from "./explain";
import { Figure } from "./figure";
import { formatMicro, formatPer, formatPercent } from "./format";

/** The conversion breakdowns of a campaign (Analytics tab): totals, per sender id, per ad text. */

function Stat({
  label,
  value,
  hint,
  testId,
  explanation,
}: {
  label: string;
  value: string;
  hint?: string;
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
      {hint ? (
        <dd
          className="text-xs text-neutral-500"
          data-testid={testId ? `${testId}-timing` : undefined}
        >
          {hint}
        </dd>
      ) : null}
    </div>
  );
}

/**
 * "3 same day · 1 late" under a total (D4-12): late means the sign-up or first deposit came
 * on a later UTC day than its SMS. Nothing to say without conversions.
 */
export function splitHint(total: number, late: number): string {
  if (total <= 0) return "";
  return `${Math.max(0, total - late)} same day · ${late} late`;
}

/** The cost of a sender id or ad text row is not billed per row but shared out from the laps. */
const SPLIT_COST_NOTE = LOCAL_FORMULAS.splitCost;

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
              <Th formula={LOCAL_FORMULAS.conversionSent}>Sent</Th>
              <Th>Leads</Th>
              <Th formula={FORMULAS.leadRate}>Lead rate</Th>
              <Th formula={FORMULAS.cpl}>CPL</Th>
              <Th formula={FORMULAS.sales}>Sales</Th>
              <Th formula={FORMULAS.saleRate}>Sale rate</Th>
              <Th formula={FORMULAS.cps}>CPS</Th>
              <Th formula={FORMULAS.revenue}>Revenue</Th>
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
                    <Figure
                      explanation={explainRate("leadRate", row.leads, row.sent, row.leadRate)}
                    >
                      {formatPercent(row.leadRate)}
                    </Figure>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Figure
                      explanation={explainCostPer(
                        "cpl",
                        row.costMicro,
                        row.leads,
                        row.cplMicro,
                        SPLIT_COST_NOTE,
                      )}
                    >
                      {formatPer(row.cplMicro)}
                    </Figure>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.sales}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Figure
                      explanation={explainRate("saleRate", row.sales, row.sent, row.saleRate)}
                    >
                      {formatPercent(row.saleRate)}
                    </Figure>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Figure
                      explanation={explainCostPer(
                        "cps",
                        row.costMicro,
                        row.sales,
                        row.cpsMicro,
                        SPLIT_COST_NOTE,
                      )}
                    >
                      {formatPer(row.cpsMicro)}
                    </Figure>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Figure explanation={explainRevenue(row.sales, row.revenueMicro)}>
                      {formatMicro(row.revenueMicro)}
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

export function ConversionsSection({ stats }: { stats: ConversionStats | null }) {
  if (stats === null) return null;
  const c = stats.campaign;
  return (
    <section className="space-y-4" data-testid="conversions-section">
      <h3 className="text-sm font-semibold">Conversions</h3>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
        <Stat
          label="Leads"
          value={String(c.leads)}
          hint={splitHint(c.leads, stats.timing.lateLeads)}
          testId="conversions-leads"
        />
        <Stat
          label="Lead rate"
          value={formatPercent(c.leadRate)}
          explanation={explainRate("leadRate", c.leads, c.sent, c.leadRate)}
        />
        <Stat
          label="CPL"
          value={formatPer(c.cplMicro)}
          explanation={explainCostPer("cpl", c.costMicro, c.leads, c.cplMicro)}
        />
        <Stat
          label="Sales"
          value={String(c.sales)}
          hint={splitHint(c.sales, stats.timing.lateSales)}
          testId="conversions-sales"
          explanation={{ formula: FORMULAS.sales }}
        />
        <Stat
          label="Sale rate"
          value={formatPercent(c.saleRate)}
          explanation={explainRate("saleRate", c.sales, c.sent, c.saleRate)}
        />
        <Stat
          label="CPS"
          value={formatPer(c.cpsMicro)}
          explanation={explainCostPer("cps", c.costMicro, c.sales, c.cpsMicro)}
        />
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
