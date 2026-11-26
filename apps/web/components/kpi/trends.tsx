"use client";

import {
  countryName,
  FORMULAS,
  type TrendBreakdownRow,
  type TrendDimension,
  type TrendPoint,
  type TrendSummary,
} from "@sendex/core";
import {
  Card,
  ChartFrame,
  Checkbox,
  cn,
  Explained,
  KpiStrip,
  Lines,
  PageHeader,
  SegmentedControl,
  SimpleSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { formatNumber } from "../../lib/format";
import {
  INSIGHT_FIRST_YEAR,
  MONTH_NAMES,
  type TrendsQuery,
  trendsQueryString,
} from "../../lib/kpi-params";
import {
  changeText,
  explainChange,
  explainConversionChange,
  explainHalf,
  explainLeadToSale,
  explainTrend,
  KPI_FORMULAS,
} from "./explain";
import { percent } from "./format";

/** A breakdown row with each half's leads and sales, for the hover explanations (D5-20). */
export interface TrendBreakdownView extends TrendBreakdownRow {
  firstLeads: number;
  firstSales: number;
  secondLeads: number;
  secondSales: number;
}

/** The month before over the same days, for the explanation of the change. */
export interface TrendBefore {
  leads: number;
  sales: number;
  conversion: number | null;
}

const DIMENSIONS: ReadonlyArray<{ value: TrendDimension; label: string; column: string }> = [
  { value: "route", label: "By route", column: "Route" },
  { value: "offer", label: "By offer", column: "Offer" },
  { value: "country", label: "By country", column: "Country" },
  { value: "provider", label: "By data provider", column: "Data provider" },
];

const MODES: ReadonlyArray<{ value: "daily" | "cumulative"; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "cumulative", label: "Cumulative" },
];

/**
 * Trends (D5-06), after the screen of that name in the Business KPIs Manager walkthrough:
 * how the month is doing against the month before. Leads sit on the day their SMS went out,
 * sales on the day of the deposit; the comparison is with the same days of the month before.
 */
export function Trends({
  query,
  thisYear,
  through,
  summary,
  before,
  points,
  breakdown,
}: {
  query: TrendsQuery;
  thisYear: number;
  /** The last day of the month there are figures for; 0 for a month that has not started. */
  through: number;
  summary: TrendSummary;
  before: TrendBefore;
  points: readonly TrendPoint[];
  breakdown: readonly TrendBreakdownView[];
}) {
  const router = useRouter();
  const compareId = useId();
  const navigate = (next: Partial<TrendsQuery>) =>
    router.push(`/kpi/trends${trendsQueryString({ ...query, ...next })}`, { scroll: false });
  const years = Array.from({ length: thisYear - INSIGHT_FIRST_YEAR + 1 }, (_, i) => thisYear - i);
  const dimension = DIMENSIONS.find((d) => d.value === query.by) ?? DIMENSIONS[0];
  const monthLabel = `${MONTH_NAMES[query.month - 1] ?? ""} ${query.year}`;
  const empty = summary.leads === 0 && summary.sales === 0;
  const versus = (text: string | null) =>
    text === null
      ? "No figures for the month before"
      : `${text} vs the month before (through day ${through})`;

  const series = (current: "leads" | "sales", previous: "prevLeads" | "prevSales") =>
    points.map((p) => ({
      day: String(p.day),
      ...(p[current] === null ? {} : { [current]: p[current] as number }),
      ...(query.compare ? { [previous]: p[previous] } : {}),
    }));
  const mode = query.cumulative ? "cumulative" : "daily";
  const groupLabel = (key: string) =>
    query.by === "country"
      ? countryName(key)
      : query.by === "route" && !key.startsWith("(")
        ? `Route ${key}`
        : key;

  return (
    <section className="space-y-4" data-testid="trends">
      <PageHeader
        breadcrumb={[{ label: "Performance" }, { label: "Trends" }]}
        title="Trends"
        subtitle={`${monthLabel}: leads against sales across the month, next to the month before.`}
      />

      <div className="flex flex-wrap items-center gap-3" data-testid="trends-filters">
        <SimpleSelect
          aria-label="Month"
          value={String(query.month)}
          onValueChange={(value) => navigate({ month: Number(value) })}
          options={MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }))}
          className="w-40"
        />
        <SimpleSelect
          aria-label="Year"
          value={String(query.year)}
          onValueChange={(value) => navigate({ year: Number(value) })}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
          className="w-28"
        />
        <SimpleSelect
          aria-label="Group by"
          value={query.by}
          onValueChange={(value) => navigate({ by: value as TrendDimension })}
          options={DIMENSIONS.map((d) => ({ value: d.value, label: d.label }))}
          className="w-48"
        />
        <SegmentedControl
          label="Figures"
          value={mode}
          options={MODES}
          onChange={(value) => navigate({ cumulative: value === "cumulative" })}
        />
        <label htmlFor={compareId} className="inline-flex items-center gap-2 text-sm text-ink">
          <Checkbox
            id={compareId}
            checked={query.compare}
            onCheckedChange={(checked) => navigate({ compare: checked === true })}
          />
          vs the month before
        </label>
      </div>

      <KpiStrip
        label="The month so far"
        items={[
          {
            label: <Explained formula={KPI_FORMULAS.leads}>Leads</Explained>,
            value: formatNumber(summary.leads),
            hint: (
              <Explained
                {...explainChange({
                  now: summary.leads,
                  before: before.leads,
                  change: summary.leadsChange,
                  noun: "leads",
                })}
              >
                {versus(changeText(summary.leadsChange, "percent"))}
              </Explained>
            ),
            testId: "trends-leads",
          },
          {
            label: <Explained formula={FORMULAS.sales}>Sales (FTD)</Explained>,
            value: formatNumber(summary.sales),
            hint: (
              <Explained
                {...explainChange({
                  now: summary.sales,
                  before: before.sales,
                  change: summary.salesChange,
                  noun: "sales",
                })}
              >
                {versus(changeText(summary.salesChange, "percent"))}
              </Explained>
            ),
            testId: "trends-sales",
          },
          {
            label: <Explained formula={FORMULAS.lts}>Lead → sale</Explained>,
            value: (
              <Explained
                {...explainLeadToSale({
                  leads: summary.leads,
                  sales: summary.sales,
                  leadToSale: summary.conversion,
                })}
              >
                {percent(summary.conversion)}
              </Explained>
            ),
            hint: (
              <Explained
                {...explainConversionChange({
                  now: summary.conversion,
                  before: before.conversion,
                  points: summary.conversionChangePoints,
                })}
              >
                {versus(changeText(summary.conversionChangePoints, "points"))}
              </Explained>
            ),
            testId: "trends-conversion",
          },
        ]}
      />

      {empty ? (
        <Card className="p-6 text-sm text-muted" data-testid="trends-empty">
          No lead and no sale in {monthLabel}. Pick another month.
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartFrame
              title={`Leads (${mode})`}
              subtitle="Registrations of the SMS sent each day."
              testId="trends-leads-chart"
            >
              <Lines
                data={series("leads", "prevLeads")}
                xKey="day"
                series={[
                  { key: "leads", label: "Leads" },
                  ...(query.compare
                    ? [{ key: "prevLeads", label: "Leads, month before", dashed: true }]
                    : []),
                ]}
              />
            </ChartFrame>
            <ChartFrame
              title={`Sales (${mode})`}
              subtitle="First deposits made each day."
              testId="trends-sales-chart"
            >
              <Lines
                data={series("sales", "prevSales")}
                xKey="day"
                series={[
                  { key: "sales", label: "Sales" },
                  ...(query.compare
                    ? [{ key: "prevSales", label: "Sales, month before", dashed: true }]
                    : []),
                ]}
              />
            </ChartFrame>
          </div>

          <Card className="p-5" data-testid="trends-breakdown">
            <h2 className="text-sm font-semibold text-ink">Breakdown</h2>
            <p className="text-xs text-muted">
              The month per {dimension?.column.toLowerCase()}, with the conversion of its first and
              second half. The arrow says whether the second half converts better than the first.
            </p>
            <Table className="mt-3">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{dimension?.column}</TableHead>
                  <TableHead className="text-right">
                    <Explained formula={KPI_FORMULAS.leads}>Leads</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={FORMULAS.sales}>Sales</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={FORMULAS.lts}>Lead → sale</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={KPI_FORMULAS.firstHalf}>Days 1–15</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={KPI_FORMULAS.secondHalf}>Day 16–end</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={KPI_FORMULAS.trend}>Trend</Explained>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.map((row) => (
                  <TableRow key={row.key} data-testid="trends-breakdown-row" data-key={row.key}>
                    <TableCell className="font-medium text-ink">{groupLabel(row.key)}</TableCell>
                    <NumCell>{formatNumber(row.leads)}</NumCell>
                    <NumCell>{formatNumber(row.sales)}</NumCell>
                    <NumCell>
                      <Explained
                        {...explainLeadToSale({
                          leads: row.leads,
                          sales: row.sales,
                          leadToSale: row.conversion,
                        })}
                      >
                        {percent(row.conversion)}
                      </Explained>
                    </NumCell>
                    <NumCell>
                      <Explained
                        {...explainHalf("first", {
                          leads: row.firstLeads,
                          sales: row.firstSales,
                          rate: row.firstHalf,
                        })}
                      >
                        {percent(row.firstHalf)}
                      </Explained>
                    </NumCell>
                    <NumCell>
                      <Explained
                        {...explainHalf("second", {
                          leads: row.secondLeads,
                          sales: row.secondSales,
                          rate: row.secondHalf,
                        })}
                      >
                        {percent(row.secondHalf)}
                      </Explained>
                    </NumCell>
                    <TableCell className="text-right">
                      <Explained
                        {...explainTrend({
                          first: row.firstHalf,
                          second: row.secondHalf,
                          trend: row.trend,
                        })}
                      >
                        <TrendMark trend={row.trend} />
                      </Explained>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </section>
  );
}

function NumCell({ children }: { children: React.ReactNode }) {
  return <TableCell className="text-right font-mono tabular-nums">{children}</TableCell>;
}

function TrendMark({ trend }: { trend: TrendBreakdownRow["trend"] }) {
  if (trend === null) return <span className="text-muted">–</span>;
  const Icon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const label = trend === "up" ? "Better" : trend === "down" ? "Worse" : "Same";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        trend === "up" && "text-good",
        trend === "down" && "text-signal",
        trend === "flat" && "text-muted",
      )}
      data-trend={trend}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
