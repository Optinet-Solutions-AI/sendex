"use client";

import {
  type PivotDimension,
  type PivotMetricKey,
  type PivotMetrics,
  type PivotNode,
  type PivotRow,
  pivotTree,
  ROI_METRICS,
} from "@sendex/core";
import {
  Button,
  ChartFrame,
  ChartTable,
  Checkbox,
  cn,
  Lines,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@sendex/ui";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Download,
  GripVertical,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { eur, monthLabel, pct } from "./format";

/** A pivot row as it crosses the server boundary (bigints as strings). */
export interface RoiRowView {
  country: string;
  link: string;
  list: string;
  month: string;
  cost: string;
  clicks: number;
  leads: number;
  sales: number;
  revenue: string;
}

export interface CpsPointView {
  month: string;
  monthlyCpsMicro: number | null;
  cumulativeCpsMicro: number | null;
}

export interface RoiTabProps {
  rows: RoiRowView[];
  cps: CpsPointView[];
  windowLabel: string;
}

const DIMENSIONS: ReadonlyArray<{ value: PivotDimension; label: string }> = [
  { value: "country", label: "Country" },
  { value: "link", label: "Link" },
  { value: "list", label: "List" },
  { value: "date", label: "Date" },
];

function cell(m: PivotMetrics, key: PivotMetricKey): { text: string; negative: boolean } {
  switch (key) {
    case "cost":
      return { text: eur(Number(m.cost)), negative: false };
    case "clicks":
      return { text: m.clicks.toLocaleString("en-GB"), negative: false };
    case "leads":
      return { text: m.leads.toLocaleString("en-GB"), negative: false };
    case "sales":
      return { text: m.sales.toLocaleString("en-GB"), negative: false };
    case "cpc":
      return { text: m.cpcMicro === null ? "—" : eur(Number(m.cpcMicro)), negative: false };
    case "cpl":
      return { text: m.cplMicro === null ? "—" : eur(Number(m.cplMicro)), negative: false };
    case "cps":
      return { text: m.cpsMicro === null ? "—" : eur(Number(m.cpsMicro)), negative: false };
    case "ctl":
      return { text: pct(m.ctl), negative: false };
    case "cts":
      return { text: pct(m.cts), negative: false };
    case "lts":
      return { text: pct(m.lts), negative: false };
    case "profit":
      return { text: eur(Number(m.profitMicro)), negative: m.profitMicro < 0n };
    case "roi":
      return { text: m.roi === null ? "—" : pct(m.roi, 0), negative: m.roi !== null && m.roi < 0 };
  }
}

function toPivotRows(rows: readonly RoiRowView[]): PivotRow[] {
  return rows.map((r) => ({ ...r, cost: BigInt(r.cost), revenue: BigInt(r.revenue) }));
}

function flatten(nodes: readonly PivotNode[], expanded: ReadonlySet<string>): PivotNode[] {
  const out: PivotNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children.length > 0 && expanded.has(n.key)) out.push(...flatten(n.children, expanded));
  }
  return out;
}

function allKeys(nodes: readonly PivotNode[]): string[] {
  return nodes.flatMap((n) => (n.children.length > 0 ? [n.key, ...allKeys(n.children)] : []));
}

function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The ROI pivot of the spec: row chips (Country, Link, List, + Group, + Date), a Columns
 * dropdown, Metrics (n), Expand, Collapse and CSV; the table nests by the row dimensions,
 * sorts by any metric, paints negative profit and ROI red and ends with a Grand Total.
 * Below it, cost per sale accumulated over time, account-wide.
 */
export function RoiTab({ rows, cps, windowLabel }: RoiTabProps) {
  const [dims, setDims] = useState<PivotDimension[]>(["country", "link", "list"]);
  const [metrics, setMetrics] = useState<PivotMetricKey[]>(
    ROI_METRICS.filter((m) => m.default).map((m) => m.key),
  );
  const [sort, setSort] = useState<PivotMetricKey>("cost");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const pivotRows = useMemo(() => toPivotRows(rows), [rows]);
  const tree = useMemo(
    () => pivotTree(pivotRows, dims, { sort, dir }),
    [pivotRows, dims, sort, dir],
  );
  const visible = flatten(tree.nodes, expanded);
  const shownMetrics = ROI_METRICS.filter((m) => metrics.includes(m.key));
  const unusedDims = DIMENSIONS.filter((d) => !dims.includes(d.value));

  const toggleMetric = (key: PivotMetricKey) =>
    setMetrics((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const removeDim = (dim: PivotDimension) => setDims((prev) => prev.filter((d) => d !== dim));
  const addDim = (dim: PivotDimension) => setDims((prev) => [...prev, dim]);
  const onSort = (key: PivotMetricKey) => {
    if (sort === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDir("desc");
    }
  };
  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const downloadCsv = () => {
    const header = [
      dims.map((d) => DIMENSIONS.find((x) => x.value === d)?.label ?? d).join(" / "),
      ...shownMetrics.map((m) => m.label),
    ];
    const lines = [
      header,
      ...flatten(tree.nodes, new Set(allKeys(tree.nodes))).map((n) => [
        n.path.join(" / "),
        ...shownMetrics.map((m) => cell(n.metrics, m.key).text),
      ]),
      ["Grand Total", ...shownMetrics.map((m) => cell(tree.total.metrics, m.key).text)],
    ];
    const blob = new Blob([lines.map((l) => l.map(csvEscape).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "roi-pivot.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const cpsData = cps.map((p) => ({
    month: p.month,
    monthly: p.monthlyCpsMicro === null ? null : p.monthlyCpsMicro / 1_000_000,
    cumulative: p.cumulativeCpsMicro === null ? null : p.cumulativeCpsMicro / 1_000_000,
  }));

  return (
    <div className="space-y-4" data-testid="roi-tab">
      <section className="rounded-lg border border-rule bg-surface">
        <div className="border-b border-rule px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">ROI pivot</h2>
          <p className="text-xs text-muted">
            Cost, conversions and ROI by{" "}
            {dims.length === 0
              ? "everything"
              : dims
                  .map((d) => DIMENSIONS.find((x) => x.value === d)?.label.toLowerCase())
                  .join(" / ")}{" "}
            · {windowLabel}
            {windowLabel === "all time" ? "" : " — set a date range above to widen"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2 text-xs">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Rows</span>
          {dims.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1 rounded-full border border-rule bg-page px-2 py-0.5"
              data-testid={`roi-chip-${d}`}
            >
              <GripVertical className="h-3 w-3 text-muted" aria-hidden="true" />
              {DIMENSIONS.find((x) => x.value === d)?.label}
              <button
                type="button"
                aria-label={`Remove ${d}`}
                onClick={() => removeDim(d)}
                className="text-muted hover:text-ink"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {unusedDims.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => addDim(d.value)}
              className="rounded-full border border-dashed border-neutral-400 px-2 py-0.5 text-muted hover:text-ink"
              data-testid={`roi-add-${d.value}`}
            >
              + {d.value === "date" ? "Date" : "Group"}
              {d.value === "date" ? "" : ` (${d.label})`}
            </button>
          ))}
          <span className="ml-3 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            Columns
          </span>
          <select
            aria-label="Columns"
            className="rounded-md border border-rule bg-surface px-2 py-0.5 text-xs"
            defaultValue="none"
          >
            <option value="none">None</option>
          </select>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" data-testid="roi-metrics">
                  Metrics ({shownMetrics.length})
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <ul className="space-y-1">
                  {ROI_METRICS.map((m) => (
                    <li key={m.key}>
                      <label
                        htmlFor={`roi-metric-${m.key}`}
                        className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-neutral-50"
                      >
                        <Checkbox
                          id={`roi-metric-${m.key}`}
                          checked={metrics.includes(m.key)}
                          onCheckedChange={() => toggleMetric(m.key)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="text-sm text-ink">{m.label}</span>
                          <span className="block text-xs text-muted">{m.description}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(new Set(allKeys(tree.nodes)))}
              data-testid="roi-expand"
            >
              Expand
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExpanded(new Set())}>
              Collapse
            </Button>
            <Button variant="outline" size="sm" onClick={downloadCsv}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> CSV
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="roi-table">
            <thead className="bg-page">
              <tr>
                <th
                  rowSpan={2}
                  className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted"
                >
                  {dims.length === 0
                    ? "Total"
                    : dims.map((d) => DIMENSIONS.find((x) => x.value === d)?.label).join(" / ")}
                </th>
                <th
                  colSpan={shownMetrics.length}
                  className="border-b border-rule px-3 py-1 text-center font-mono text-[11px] uppercase tracking-[0.06em] text-muted"
                >
                  Grand Total
                </th>
              </tr>
              <tr>
                {shownMetrics.map((m) => {
                  const active = sort === m.key;
                  return (
                    <th
                      key={m.key}
                      className="px-3 py-1.5 text-right font-mono text-[11px] uppercase tracking-[0.06em] text-muted"
                    >
                      <button
                        type="button"
                        onClick={() => onSort(m.key)}
                        className="inline-flex items-center gap-1 hover:text-ink"
                        data-testid={`roi-sort-${m.key}`}
                      >
                        {m.label}
                        {active ? (
                          dir === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden="true" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={shownMetrics.length + 1}
                    className="px-3 py-8 text-center text-muted"
                  >
                    {dims.length === 0
                      ? "Add a row dimension to break the total down."
                      : "No sends in this period."}
                  </td>
                </tr>
              ) : (
                visible.map((n) => {
                  const open = expanded.has(n.key);
                  return (
                    <tr
                      key={n.key}
                      className="border-t border-rule hover:bg-neutral-50"
                      data-testid="roi-row"
                      data-depth={n.depth}
                    >
                      <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + n.depth * 18}px` }}>
                        {n.children.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleRow(n.key)}
                            aria-expanded={open}
                            className="inline-flex items-center gap-1 text-ink hover:underline"
                          >
                            {open ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                            )}
                            {n.label}
                          </button>
                        ) : (
                          <span className="pl-[18px] text-ink">{n.label}</span>
                        )}
                      </td>
                      {shownMetrics.map((m) => {
                        const c = cell(n.metrics, m.key);
                        return (
                          <td
                            key={m.key}
                            className={cn(
                              "px-3 py-1.5 text-right font-mono tabular-nums",
                              c.negative && "text-signal",
                            )}
                          >
                            {c.text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
              <tr className="border-t-2 border-rule bg-page font-semibold" data-testid="roi-total">
                <td className="px-3 py-2">Grand Total</td>
                {shownMetrics.map((m) => {
                  const c = cell(tree.total.metrics, m.key);
                  return (
                    <td
                      key={m.key}
                      className={cn(
                        "px-3 py-2 text-right font-mono tabular-nums",
                        c.negative && "text-signal",
                      )}
                    >
                      {c.text}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <ChartFrame
        title="Cost per sale — accumulated over time"
        subtitle="Cumulative vs monthly cost per sale. Account-wide — not split by the country filter."
        empty={cps.length === 0}
        table={
          <ChartTable
            columns={["Month", "Monthly", "Cumulative"]}
            rows={cps.map((p) => [
              monthLabel(p.month),
              eur(p.monthlyCpsMicro),
              eur(p.cumulativeCpsMicro),
            ])}
          />
        }
        testId="chart-cps"
      >
        <Lines
          data={cpsData as unknown as ReadonlyArray<Record<string, number | string>>}
          xKey="month"
          xFormat={monthLabel}
          format={(v) => `€${v.toFixed(2)}`}
          series={[
            { key: "cumulative", label: "Cumulative", color: "#008300", dashed: true },
            { key: "monthly", label: "Monthly", color: "#1c3a63" },
          ]}
        />
      </ChartFrame>
    </div>
  );
}
