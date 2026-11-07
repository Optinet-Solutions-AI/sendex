"use client";

import { type ReactNode, useId, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Card, CardHeader } from "./card.js";
import { cn } from "./cn.js";

/**
 * The chart kit of the dashboard (D4-05), on recharts. One validated categorical palette in
 * fixed slot order (a series keeps its colour whatever the filter does), thin marks with a
 * surface gap, hairline grid, a tooltip that lists every series, and a table twin behind a
 * toggle on every chart.
 */

/** Eight slots validated for adjacent CVD separation on the white card; "Other" is grey. */
export const CHART_SERIES = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
] as const;
export const CHART_OTHER = "#898781";
/** The two-series pair (contacts vs sent): blue and green, validated together. */
export const CHART_PAIR = ["#2a78d6", "#008300"] as const;
export const CHART_INK = "#142033";
export const CHART_MUTED = "#566275";
export const CHART_GRID = "#e6eaf0";
export const CHART_SURFACE = "#ffffff";
/** Sequential blue ramp, light to dark, for a magnitude (cost per sale on the scatter). */
export const CHART_SEQUENTIAL = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
] as const;

/** The colour of series number `index` (0-based); `Other` is always grey. */
export function seriesColor(index: number, key?: string): string {
  if (key === "Other") return CHART_OTHER;
  return CHART_SERIES[index % CHART_SERIES.length] ?? CHART_OTHER;
}

/** The step of the sequential ramp for `value` between `min` and `max`. */
export function sequentialColor(value: number, min: number, max: number): string {
  if (max <= min) return CHART_SEQUENTIAL[3];
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return CHART_SEQUENTIAL[Math.round(t * (CHART_SEQUENTIAL.length - 1))] ?? CHART_SEQUENTIAL[3];
}

const thousands = (n: number) => n.toLocaleString("en-GB");
const identity = (label: string) => label;

/** 0 / 10K / 1.2M axis ticks. */
export function axisTick(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1_000)}K`;
  return thousands(n);
}

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

interface TooltipEntry {
  name?: string | number | undefined;
  value?: number | string | undefined;
  color?: string | undefined;
  dataKey?: string | number | undefined;
}

interface TooltipContentProps {
  active?: boolean | undefined;
  payload?: ReadonlyArray<TooltipEntry> | undefined;
  label?: string | number | undefined;
}

/** The hover readout: the x label, then every series with its value first and a line key. */
export function ChartTooltipContent({
  active,
  payload,
  label,
  format = thousands,
  labelFormat,
}: TooltipContentProps & {
  format?: ((value: number, key: string) => string) | undefined;
  labelFormat?: ((label: string) => string) | undefined;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const heading = label === undefined ? "" : String(label);
  return (
    <div className="rounded-md border border-rule bg-surface px-3 py-2 text-xs shadow-md">
      {heading ? (
        <div className="mb-1 font-medium text-ink">
          {labelFormat ? labelFormat(heading) : heading}
        </div>
      ) : null}
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={String(entry.dataKey ?? entry.name)} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-3 rounded"
              style={{ background: entry.color ?? CHART_INK }}
            />
            <span className="font-mono font-semibold tabular-nums text-ink">
              {typeof entry.value === "number"
                ? format(entry.value, String(entry.dataKey ?? ""))
                : String(entry.value ?? "")}
            </span>
            <span className="text-muted">{String(entry.name ?? "")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ChartFrameProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** The chart. */
  children: ReactNode;
  /** The accessible twin, shown instead of the chart when the reader asks for it. */
  table?: ReactNode;
  /** Shown instead of the chart when there is nothing to plot. */
  empty?: boolean;
  emptyText?: ReactNode;
  className?: string;
  testId?: string;
}

/** A card with the title, subtitle, a Chart | Table switch and the plot. */
export function ChartFrame({
  title,
  subtitle,
  actions,
  children,
  table,
  empty = false,
  emptyText = "No data in this period.",
  className,
  testId,
}: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <Card className={cn("flex flex-col", className)} data-testid={testId}>
      <CardHeader
        title={title}
        actions={
          <>
            {actions}
            {table ? (
              <button
                type="button"
                aria-pressed={showTable}
                aria-controls={id}
                onClick={() => setShowTable((v) => !v)}
                className="rounded-md border border-rule px-2 py-0.5 text-xs text-muted hover:bg-neutral-100 hover:text-ink"
                data-testid="chart-table-toggle"
              >
                {showTable ? "Chart" : "Table"}
              </button>
            ) : null}
          </>
        }
      />
      {subtitle ? <p className="px-4 pt-3 text-xs text-muted">{subtitle}</p> : null}
      <div id={id} className="p-4">
        {empty ? (
          <div className="py-10 text-center text-sm text-muted" data-testid="chart-empty">
            {emptyText}
          </div>
        ) : showTable && table ? (
          <div className="overflow-x-auto" data-testid="chart-table">
            {table}
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/** A plain data table for a chart's table twin. */
export function ChartTable({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<ReactNode>>;
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th
              key={c}
              className={cn(
                "border-b border-rule px-2 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-muted",
                i === 0 ? "text-left" : "text-right",
              )}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position
          <tr key={ri}>
            {r.map((cell, ci) => (
              <td
                // biome-ignore lint/suspicious/noArrayIndexKey: cells have no identity beyond their column
                key={`${ri}-${ci}`}
                className={cn(
                  "border-b border-rule/60 px-2 py-1 tabular-nums",
                  ci === 0 ? "text-left text-ink" : "text-right",
                )}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface SeriesChartProps {
  data: ReadonlyArray<Record<string, number | string>>;
  xKey: string;
  series: readonly SeriesDef[];
  height?: number;
  format?: (value: number, key: string) => string;
  xFormat?: ((label: string) => string) | undefined;
  /** Colours by position, or a fixed palette (the two-series pair). */
  palette?: readonly string[];
}

const legendStyle = { fontSize: 12, color: CHART_MUTED };
const axisStyle = { fontSize: 11, fill: CHART_MUTED };

/** Stacked columns per period (contacts uploaded, SMS sent per country). */
export function StackedBars({
  data,
  xKey,
  series,
  height = 260,
  format,
  xFormat,
  palette,
}: SeriesChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={[...data]}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barCategoryGap="30%"
      >
        <CartesianGrid vertical={false} stroke={CHART_GRID} />
        <XAxis
          dataKey={xKey}
          tick={axisStyle}
          tickLine={false}
          axisLine={{ stroke: CHART_GRID }}
          tickFormatter={xFormat ?? identity}
        />
        <YAxis
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={axisTick}
          width={44}
        />
        <Tooltip
          cursor={{ fill: "rgba(20,32,51,0.04)" }}
          content={<ChartTooltipContent format={format} labelFormat={xFormat} />}
        />
        {series.length > 1 ? (
          <Legend wrapperStyle={legendStyle} iconType="square" iconSize={10} />
        ) : null}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="stack"
            fill={s.color ?? palette?.[i] ?? seriesColor(i, s.key)}
            stroke={CHART_SURFACE}
            strokeWidth={1}
            maxBarSize={24}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal grouped bars: one row per category, a bar per series (contacts vs sent). */
export function GroupedHBars({
  data,
  xKey,
  series,
  height,
  format,
  palette = CHART_PAIR,
}: SeriesChartProps) {
  const h = height ?? Math.max(160, data.length * 44 + 40);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart
        data={[...data]}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
        barCategoryGap="25%"
        barGap={2}
      >
        <CartesianGrid horizontal={false} stroke={CHART_GRID} />
        <XAxis
          type="number"
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={axisTick}
        />
        <YAxis
          type="category"
          dataKey={xKey}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          width={110}
        />
        <Tooltip
          cursor={{ fill: "rgba(20,32,51,0.04)" }}
          content={<ChartTooltipContent format={format} />}
        />
        {series.length > 1 ? (
          <Legend wrapperStyle={legendStyle} iconType="square" iconSize={10} />
        ) : null}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? palette[i] ?? seriesColor(i, s.key)}
            radius={[0, 4, 4, 0]}
            maxBarSize={14}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface StackedHBarsWithDotProps extends SeriesChartProps {
  /** The key of the value drawn as a dot on the top axis (the bucket CTR, 0 to 1). */
  dotKey: string;
  dotLabel: string;
}

/** Horizontal stacked bars per bucket with a dot on a second, top axis (send-count distribution). */
export function StackedHBarsWithDot({
  data,
  xKey,
  series,
  dotKey,
  dotLabel,
  height,
  format,
}: StackedHBarsWithDotProps) {
  const h = height ?? Math.max(180, data.length * 48 + 56);
  const dotMax = Math.max(0.01, ...data.map((d) => Number(d[dotKey] ?? 0)));
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart
        data={[...data]}
        layout="vertical"
        margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} stroke={CHART_GRID} />
        <XAxis
          xAxisId="count"
          type="number"
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={axisTick}
        />
        <XAxis
          xAxisId="rate"
          type="number"
          orientation="top"
          domain={[0, dotMax]}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
        />
        <YAxis
          type="category"
          dataKey={xKey}
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip
          cursor={{ fill: "rgba(20,32,51,0.04)" }}
          content={<ChartTooltipContent format={format} />}
        />
        <Legend wrapperStyle={legendStyle} iconType="square" iconSize={10} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            xAxisId="count"
            dataKey={s.key}
            name={s.label}
            stackId="stack"
            fill={s.color ?? seriesColor(i, s.key)}
            stroke={CHART_SURFACE}
            strokeWidth={1}
            maxBarSize={18}
            isAnimationActive={false}
          />
        ))}
        <Scatter
          xAxisId="rate"
          dataKey={dotKey}
          name={dotLabel}
          fill={CHART_INK}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  /** Null draws the point grey ("no sales"). */
  colorValue: number | null;
}

/** The utilisation map: x contacts, y sends over contacts, colour = cost per sale, 100% line. */
export function UtilisationScatter({
  points,
  height = 300,
  xLabel,
  yLabel,
  colorLabel,
  formatColor,
}: {
  points: readonly ScatterPoint[];
  height?: number;
  xLabel: string;
  yLabel: string;
  colorLabel: string;
  formatColor: (value: number) => string;
}) {
  const values = points.map((p) => p.colorValue).filter((v): v is number => v !== null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={CHART_GRID} />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            tick={axisStyle}
            tickLine={false}
            axisLine={{ stroke: CHART_GRID }}
            tickFormatter={axisTick}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            width={48}
          />
          <ZAxis range={[90, 90]} />
          <ReferenceLine y={1} stroke={CHART_MUTED} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as ScatterPoint | undefined;
              if (!active || !p) return null;
              return (
                <div className="rounded-md border border-rule bg-surface px-3 py-2 text-xs shadow-md">
                  <div className="mb-1 font-medium text-ink">{p.label}</div>
                  <div>
                    <span className="font-mono font-semibold tabular-nums">{thousands(p.x)}</span>{" "}
                    <span className="text-muted">{xLabel}</span>
                  </div>
                  <div>
                    <span className="font-mono font-semibold tabular-nums">
                      {Math.round(p.y * 100)}%
                    </span>{" "}
                    <span className="text-muted">{yLabel}</span>
                  </div>
                  <div>
                    <span className="font-mono font-semibold tabular-nums">
                      {p.colorValue === null ? "—" : formatColor(p.colorValue)}
                    </span>{" "}
                    <span className="text-muted">{colorLabel}</span>
                  </div>
                </div>
              );
            }}
          />
          <Scatter
            data={[...points]}
            isAnimationActive={false}
            stroke={CHART_SURFACE}
            strokeWidth={2}
          >
            {points.map((p) => (
              <Cell
                key={p.label}
                fill={p.colorValue === null ? CHART_OTHER : sequentialColor(p.colorValue, min, max)}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        <span>{colorLabel}:</span>
        <span className="font-mono tabular-nums">{values.length ? formatColor(min) : "—"}</span>
        <span
          aria-hidden="true"
          className="h-2 w-24 rounded"
          style={{
            background: `linear-gradient(90deg, ${CHART_SEQUENTIAL[0]}, ${CHART_SEQUENTIAL[6]})`,
          }}
        />
        <span className="font-mono tabular-nums">{values.length ? formatColor(max) : "—"}</span>
        <span className="ml-2 inline-flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: CHART_OTHER }}
          />
          no sales
        </span>
      </div>
    </div>
  );
}

/** Stacked areas per period (signups and buyers accumulated over time). */
export function StackedArea({
  data,
  xKey,
  series,
  height = 220,
  format,
  xFormat,
}: SeriesChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={[...data]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_GRID} />
        <XAxis
          dataKey={xKey}
          tick={axisStyle}
          tickLine={false}
          axisLine={{ stroke: CHART_GRID }}
          tickFormatter={xFormat ?? identity}
        />
        <YAxis
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={axisTick}
          width={44}
        />
        <Tooltip content={<ChartTooltipContent format={format} labelFormat={xFormat} />} />
        {series.length > 1 ? (
          <Legend wrapperStyle={legendStyle} iconType="square" iconSize={10} />
        ) : null}
        {series.map((s, i) => {
          const color = s.color ?? seriesColor(i, s.key);
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stackId="stack"
              stroke={color}
              strokeWidth={2}
              fill={color}
              fillOpacity={0.15}
              isAnimationActive={false}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface LineDef extends SeriesDef {
  dashed?: boolean;
}

/** Lines on one axis (monthly and cumulative cost per sale). */
export function Lines({
  data,
  xKey,
  series,
  height = 220,
  format,
  xFormat,
}: Omit<SeriesChartProps, "series"> & { series: readonly LineDef[] }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={[...data]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_GRID} />
        <XAxis
          dataKey={xKey}
          tick={axisStyle}
          tickLine={false}
          axisLine={{ stroke: CHART_GRID }}
          tickFormatter={xFormat ?? identity}
        />
        <YAxis
          tick={axisStyle}
          tickLine={false}
          axisLine={false}
          tickFormatter={axisTick}
          width={56}
        />
        <Tooltip content={<ChartTooltipContent format={format} labelFormat={xFormat} />} />
        {series.length > 1 ? <Legend wrapperStyle={legendStyle} iconType="plainline" /> : null}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? seriesColor(i, s.key)}
            strokeWidth={2}
            {...(s.dashed ? { strokeDasharray: "6 4" } : {})}
            dot={{ r: 4, strokeWidth: 2, stroke: CHART_SURFACE }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
