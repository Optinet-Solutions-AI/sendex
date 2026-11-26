"use client";

import { compactNumber, FORMULAS, type FoldedSeries } from "@sendex/core";
import {
  ChartFrame,
  ChartTable,
  Explained,
  KpiStrip,
  SegmentedControl,
  StackedBars,
} from "@sendex/ui";
import { useState } from "react";
import { blendedCpsFigure, DASHBOARD_FORMULAS, spendFigure } from "./explain";
import { FigureText } from "./figure";
import { countryLabel, int, monthLabel, weekLabel } from "./format";

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
  const spend = spendFigure(kpis.spendMicro);
  const blended = blendedCpsFigure(kpis.spendMicro, kpis.sales, kpis.blendedCpsMicro);
  return (
    <div className="space-y-4" data-testid="overview-tab">
      <KpiStrip
        items={[
          {
            label: (
              <Explained formula={DASHBOARD_FORMULAS.contactsInPeriod}>Contacts on file</Explained>
            ),
            value: compactNumber(kpis.contacts),
            testId: "kpi-contacts",
          },
          {
            label: <Explained formula={FORMULAS.sent}>Messages sent</Explained>,
            value: compactNumber(kpis.sent),
            testId: "kpi-sent",
          },
          {
            label: <Explained formula={spend.formula}>Spend</Explained>,
            value: <FigureText figure={spend} />,
            testId: "kpi-spend",
          },
          {
            label: <Explained formula={FORMULAS.sales}>Sales (FTD)</Explained>,
            value: int(kpis.sales),
            testId: "kpi-sales",
          },
          {
            label: <Explained formula={blended.formula}>Blended cost / sale</Explained>,
            value: <FigureText figure={blended} />,
            testId: "kpi-cps",
          },
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
