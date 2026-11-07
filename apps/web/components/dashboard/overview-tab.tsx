"use client";

import { compactNumber, type FoldedSeries } from "@sendex/core";
import { ChartFrame, ChartTable, KpiStrip, SegmentedControl, StackedBars } from "@sendex/ui";
import { useState } from "react";
import { countryLabel, eur, int, monthLabel, weekLabel } from "./format";

export interface OverviewProps {
  kpis: {
    contacts: number;
    sent: number;
    spendMicro: number;
    sales: number;
    blendedCpsMicro: number | null;
  };
  contactsByMonth: FoldedSeries;
  sentByMonth: FoldedSeries;
  sentByWeek: FoldedSeries;
}

function seriesDefs(folded: FoldedSeries) {
  return folded.series.map((key) => ({ key, label: countryLabel(key) }));
}

function tableFor(folded: FoldedSeries, label: (p: string) => string) {
  return (
    <ChartTable
      columns={["Period", ...folded.series.map(countryLabel)]}
      rows={folded.rows.map((r) => [
        label(r.period),
        ...folded.series.map((s) => int(Number(r[s] ?? 0))),
      ])}
    />
  );
}

/**
 * The Overview tab: the four tiles plus Blended cost / sale, contacts uploaded per country
 * over time, and SMS sent per country over time with a Month / Week toggle.
 */
export function OverviewTab({ kpis, contactsByMonth, sentByMonth, sentByWeek }: OverviewProps) {
  const [grain, setGrain] = useState<"month" | "week">("month");
  const sent = grain === "month" ? sentByMonth : sentByWeek;
  const sentLabel = grain === "month" ? monthLabel : weekLabel;
  return (
    <div className="space-y-4" data-testid="overview-tab">
      <KpiStrip
        items={[
          {
            label: "Contacts on file",
            value: compactNumber(kpis.contacts),
            testId: "kpi-contacts",
          },
          { label: "Messages sent", value: compactNumber(kpis.sent), testId: "kpi-sent" },
          {
            label: "Spend",
            value: `€${compactNumber(Math.round(kpis.spendMicro / 1_000_000))}`,
            testId: "kpi-spend",
          },
          { label: "Sales (FTD)", value: int(kpis.sales), testId: "kpi-sales" },
          { label: "Blended cost / sale", value: eur(kpis.blendedCpsMicro), testId: "kpi-cps" },
        ]}
      />
      <ChartFrame
        title="Contacts uploaded per country — over time"
        subtitle="Contacts added each month, stacked by country (top 8 + Other)."
        empty={contactsByMonth.rows.length === 0}
        table={tableFor(contactsByMonth, monthLabel)}
        testId="chart-contacts-uploaded"
      >
        <StackedBars
          data={contactsByMonth.rows}
          xKey="period"
          series={seriesDefs(contactsByMonth)}
          xFormat={monthLabel}
        />
      </ChartFrame>
      <ChartFrame
        title="SMS sent per country — over time"
        subtitle="Messages the carriers accepted, stacked by country (top 8 + Other)."
        actions={
          <SegmentedControl
            label="Granularity"
            size="sm"
            testIdPrefix="grain"
            value={grain}
            options={[
              { value: "month", label: "Month" },
              { value: "week", label: "Week" },
            ]}
            onChange={setGrain}
          />
        }
        empty={sent.rows.length === 0}
        table={tableFor(sent, sentLabel)}
        testId="chart-sms-sent"
      >
        <StackedBars data={sent.rows} xKey="period" series={seriesDefs(sent)} xFormat={sentLabel} />
      </ChartFrame>
    </div>
  );
}
