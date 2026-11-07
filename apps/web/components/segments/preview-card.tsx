"use client";

import { countryName } from "@sendex/core";
import { Card, PillTabs } from "@sendex/ui";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { formatNumber } from "../../lib/format";
import type { SegmentPreviewView } from "./types";

type PreviewTab = "sample" | "countries" | "networks" | "devices";

function Breakdown({
  rows,
  labelOf,
}: {
  rows: Array<{ key: string; count: number }>;
  labelOf?: (k: string) => string;
}) {
  if (rows.length === 0)
    return <p className="py-6 text-center text-sm text-muted">No data available</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 text-sm">
          <span className="w-40 truncate text-ink">{labelOf ? labelOf(r.key) : r.key}</span>
          <span className="h-2 flex-1 overflow-hidden rounded bg-neutral-200">
            <span className="block h-full bg-navy" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="w-16 text-right font-mono text-xs tabular-nums text-muted">
            {formatNumber(r.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Preview card: "Add rules to see audience count" before any rules; then TOTAL, GOOD and
 * CACHED (• • • while loading, a spinner top right) and the Sample, Countries, Networks and
 * Devices tabs, "No data available" when empty.
 */
export function PreviewCard({
  preview,
  loading,
  hasRules,
  error,
  title = "Preview",
}: {
  preview: SegmentPreviewView | null;
  loading: boolean;
  hasRules: boolean;
  error: string | null;
  title?: string;
}) {
  const [tab, setTab] = useState<PreviewTab>("sample");
  const big = (value: number | undefined, testId: string) => (
    <span className="text-2xl font-semibold tabular-nums text-ink" data-testid={testId}>
      {loading || value === undefined ? "• • •" : formatNumber(value)}
    </span>
  );
  return (
    <Card data-testid="segment-preview">
      <div className="flex items-center justify-between border-b border-rule px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Loading" />
        ) : null}
      </div>
      {!hasRules ? (
        <p className="px-4 py-10 text-center text-sm text-muted">Add rules to see audience count</p>
      ) : (
        <div className="space-y-4 p-4">
          {error ? <p className="text-sm text-signal">{error}</p> : null}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Total
              </div>
              {big(preview?.total, "preview-total")}
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Good
              </div>
              {big(preview?.good, "preview-good")}
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Cached
              </div>
              {big(preview?.cached, "preview-cached")}
            </div>
          </div>
          <PillTabs
            label="Preview sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "sample", label: "Sample" },
              { value: "countries", label: "Countries" },
              { value: "networks", label: "Networks" },
              { value: "devices", label: "Devices" },
            ]}
          />
          <div>
            {tab === "sample" ? (
              preview && preview.sample.length > 0 ? (
                <ul
                  className="grid grid-cols-2 gap-1 font-mono text-xs text-ink"
                  data-testid="preview-sample"
                >
                  {preview.sample.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-muted">No data available</p>
              )
            ) : tab === "countries" ? (
              <Breakdown
                rows={preview?.countries ?? []}
                labelOf={(k) => `${k} ${countryName(k)}`}
              />
            ) : tab === "networks" ? (
              <Breakdown rows={preview?.networks ?? []} />
            ) : (
              <Breakdown rows={preview?.devices ?? []} />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
