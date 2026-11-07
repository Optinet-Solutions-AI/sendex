"use client";

import { countryName } from "@sendex/core";
import { Button, Card } from "@sendex/ui";
import { BarChart3, Plus, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatNumber } from "../../lib/format";

export type AnalyticsDimensionView = "country" | "device";

export interface AnalyticsRowView {
  keys: string[];
  audience: number;
  sent: number;
  clicks: number;
  ctr: number;
  leads: number;
  sales: number;
  costMicro: number;
  revenueMicro: number;
}

const ALL_DIMENSIONS: ReadonlyArray<{ value: AnalyticsDimensionView; label: string }> = [
  { value: "device", label: "Device Type" },
  { value: "country", label: "Country" },
];

const TH =
  "whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted";
const TD = "px-3 py-2 text-right font-mono text-sm tabular-nums";

const eur = (micro: number) =>
  `€${(micro / 1_000_000).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function keyLabel(dimension: AnalyticsDimensionView, key: string): string {
  if (key === "unknown") return "Unknown";
  if (dimension === "country") return `${key} ${countryName(key)}`;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * The Analytics tab of the spec: a "📊 List Analytics" card with the query time, Refresh,
 * ACTIVE and ADD dimension chips (Device Type, Country) whose order sets the grouping, and
 * the grouped table with AUDIENCE, SENT, CLICKS, CTR, LEADS, SALES, COST and REVENUE.
 */
export function AnalyticsTab({
  listId,
  dimensions,
  rows,
  queryMs,
}: {
  listId: string;
  dimensions: AnalyticsDimensionView[];
  rows: AnalyticsRowView[];
  queryMs: number;
}) {
  const router = useRouter();
  const inactive = ALL_DIMENSIONS.filter((d) => !dimensions.includes(d.value));

  function go(next: AnalyticsDimensionView[]) {
    const params = new URLSearchParams({ tab: "analytics" });
    if (next.length > 0) params.set("dims", next.join(","));
    router.push(`/lists/${listId}?${params.toString()}`);
  }

  const firstHeader =
    dimensions.length === 0
      ? "List"
      : dimensions.map((d) => ALL_DIMENSIONS.find((x) => x.value === d)?.label ?? d).join(" / ");

  return (
    <Card data-testid="list-analytics">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <BarChart3 className="h-4 w-4 text-navy" aria-hidden="true" /> List Analytics
          <span className="font-mono text-xs font-normal text-muted">{queryMs}ms</span>
        </h3>
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-4 px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono uppercase tracking-[0.06em] text-muted">Active</span>
          {dimensions.length === 0 ? <span className="text-muted">none</span> : null}
          {dimensions.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => go(dimensions.filter((x) => x !== d))}
              className="inline-flex items-center gap-1 rounded-full bg-navy-soft px-2.5 py-1 text-ink hover:bg-navy/20"
              aria-label={`Remove ${ALL_DIMENSIONS.find((x) => x.value === d)?.label ?? d}`}
            >
              {ALL_DIMENSIONS.find((x) => x.value === d)?.label ?? d}
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono uppercase tracking-[0.06em] text-muted">Add</span>
          {inactive.length === 0 ? <span className="text-muted">none left</span> : null}
          {inactive.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => go([...dimensions, d.value])}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 px-2.5 py-1 text-ink hover:border-navy"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto border-t border-rule">
        <table className="w-full text-sm" data-testid="list-analytics-table">
          <thead className="bg-page">
            <tr>
              <th className={`${TH} text-left`}>{firstHeader}</th>
              <th className={TH}>Audience</th>
              <th className={TH}>Sent</th>
              <th className={TH}>Clicks</th>
              <th className={TH}>CTR</th>
              <th className={TH}>Leads</th>
              <th className={TH}>Sales</th>
              <th className={TH}>Cost</th>
              <th className={TH}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.keys.join("|") || "all"} className="border-t border-rule">
                <td className="px-3 py-2 text-sm font-medium text-ink">
                  {row.keys.length === 0
                    ? "Whole list"
                    : row.keys.map((k, i) => keyLabel(dimensions[i] ?? "country", k)).join(" / ")}
                </td>
                <td className={TD}>{formatNumber(row.audience)}</td>
                <td className={TD}>{formatNumber(row.sent)}</td>
                <td className={TD}>{formatNumber(row.clicks)}</td>
                <td className={TD}>{(row.ctr * 100).toFixed(1)}%</td>
                <td className={TD}>{formatNumber(row.leads)}</td>
                <td className={TD}>{formatNumber(row.sales)}</td>
                <td className={TD}>{eur(row.costMicro)}</td>
                <td className={TD}>{eur(row.revenueMicro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
