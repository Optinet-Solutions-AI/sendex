"use client";

import { resultRates } from "@sendex/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleLapAction } from "../../app/(dashboard)/campaigns/actions";
import { formatMicro, formatPer, formatPercent, formatPeriod, shortId } from "./format";
import type { LapView } from "./types";
import { ErrorText, StatusBadge, Toggle } from "./ui";

/** Columns the table can be sorted by; `rank` is the default (unranked laps last). */
export type LapSortKey =
  | "rank"
  | "sent"
  | "delivered"
  | "failed"
  | "clicks"
  | "ctr"
  | "cost"
  | "cpc"
  | "leads"
  | "cpl"
  | "sales"
  | "cps";

interface LapRow extends LapView {
  on: boolean;
  ctr: number;
  deliveryRate: number;
  cpcMicro: number | null;
  cplMicro: number | null;
  cpsMicro: number | null;
}

function toRow(lap: LapView): LapRow {
  const rates = resultRates({
    sent: lap.sent,
    delivered: lap.delivered,
    failed: lap.failed,
    clicks: lap.clicks,
    leads: lap.leads,
    sales: lap.sales,
    costMicro: BigInt(Math.round(lap.costMicro)),
  });
  const micro = (v: bigint | null) => (v === null ? null : Number(v));
  return {
    ...lap,
    on: lap.status !== "cancelled",
    ctr: rates.ctr,
    deliveryRate: rates.deliveryRate,
    cpcMicro: micro(rates.cpcMicro),
    cplMicro: micro(rates.cplMicro),
    cpsMicro: micro(rates.cpsMicro),
  };
}

/** Null (no rank, no cost per X yet) sorts after every number whichever the direction. */
function sortValue(row: LapRow, key: LapSortKey): number | null {
  switch (key) {
    case "rank":
      return row.rank;
    case "sent":
      return row.sent;
    case "delivered":
      return row.delivered;
    case "failed":
      return row.failed;
    case "clicks":
      return row.clicks;
    case "ctr":
      return row.ctr;
    case "cost":
      return row.costMicro;
    case "cpc":
      return row.cpcMicro;
    case "leads":
      return row.leads;
    case "cpl":
      return row.cplMicro;
    case "sales":
      return row.sales;
    case "cps":
      return row.cpsMicro;
  }
}

/** Sort laps by a column; nulls last; ties keep the server order (by creation). */
export function sortLaps(rows: readonly LapRow[], key: LapSortKey, dir: "asc" | "desc"): LapRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = sortValue(a.row, key);
      const bv = sortValue(b.row, key);
      if (av === null && bv === null) return a.index - b.index;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) return dir === "asc" ? av - bv : bv - av;
      return a.index - b.index;
    })
    .map((x) => x.row);
}

const SORTABLE: ReadonlyArray<{ key: LapSortKey; label: string }> = [
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "failed", label: "Failed" },
  { key: "clicks", label: "Clicks" },
  { key: "ctr", label: "CTR" },
  { key: "cost", label: "Cost" },
  { key: "cpc", label: "CPC" },
  { key: "leads", label: "Leads" },
  { key: "cpl", label: "CPL" },
  { key: "sales", label: "Sales" },
  { key: "cps", label: "CPS" },
  { key: "rank", label: "Rank" },
];

function SortHeader({
  sortable,
  label,
  sortKey,
  dir,
  onSort,
}: {
  sortable: LapSortKey;
  label: string;
  sortKey: LapSortKey;
  dir: "asc" | "desc";
  onSort: (key: LapSortKey) => void;
}) {
  const active = sortable === sortKey;
  return (
    <th
      className="px-2 py-2 text-right"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortable)}
        data-testid={`sort-${sortable}`}
        className={`uppercase ${active ? "font-semibold text-neutral-900" : ""}`}
      >
        {label}
        {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

/** "daily_message_cap" -> "daily cap" on the lap row (D3-11); other reasons as stored. */
function refusalLabel(reason: string | null): string {
  if (reason === "daily_message_cap") return "daily cap";
  if (reason === "daily_spend_cap") return "daily spend cap";
  return reason ?? "cap";
}

/**
 * The laps of a campaign with every SMS Edge column, sortable by rank (default) or any
 * counter, and a per-lap on/off switch. Off cancels a queued or sending lap; on re-queues a
 * cancelled one; a finished lap keeps its switch disabled.
 */
export function LapsTable({
  laps,
  timezone,
  campaignId,
  canToggle = false,
}: {
  laps: LapView[];
  timezone: string;
  campaignId?: string;
  canToggle?: boolean;
}) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<LapSortKey>("rank");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (laps.length === 0) return null;
  const rows = sortLaps(laps.map(toRow), sortKey, dir);

  function sortBy(key: LapSortKey) {
    if (key === sortKey) {
      setDir(dir === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setDir(key === "rank" ? "asc" : "desc");
  }

  function toggle(lap: LapRow, on: boolean) {
    if (!campaignId) return;
    setError(null);
    start(async () => {
      const result = await toggleLapAction({ campaignId, lapId: lap.id, on });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-2" data-testid="laps-section">
      <h3 className="text-sm font-semibold">Laps</h3>
      <ErrorText error={error} />
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm" data-testid="laps-table">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-2">Lap ID</th>
              <th className="px-2 py-2">Route</th>
              <th className="px-2 py-2">List</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2 text-right">Size</th>
              {SORTABLE.map((c) => (
                <SortHeader
                  key={c.key}
                  sortable={c.key}
                  label={c.label}
                  sortKey={sortKey}
                  dir={dir}
                  onSort={sortBy}
                />
              ))}
              <th className="px-2 py-2">Period</th>
              <th className="px-2 py-2">On</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lap) => (
              <tr
                key={lap.id}
                className="border-t border-neutral-100"
                data-testid="lap-row"
                data-lap-id={lap.id}
                data-lap-status={lap.status}
                data-lap-rank={lap.rank ?? ""}
              >
                <td className="px-2 py-1.5 font-mono text-xs text-neutral-500" title={lap.id}>
                  {shortId(lap.id)}
                </td>
                <td className="px-2 py-1.5 font-medium">{lap.routeName}</td>
                <td className="px-2 py-1.5">{lap.listName}</td>
                <td className="px-2 py-1.5">
                  <StatusBadge status={lap.status} />
                  {lap.refused > 0 ? (
                    <span
                      data-testid="lap-refused"
                      title="A daily cap refused these messages; raise the cap under Settings, Billing and resume the campaign."
                      className="mt-1 block whitespace-nowrap text-xs text-orange-800"
                    >
                      refused: {refusalLabel(lap.refusalReason)} ({lap.refused})
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{lap.testSize}</td>
                <td className="px-2 py-1.5 text-right tabular-nums" data-testid="lap-sent">
                  {lap.sent}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{lap.delivered}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{lap.failed}</td>
                <td className="px-2 py-1.5 text-right tabular-nums" data-testid="lap-clicks">
                  {lap.clicks}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPercent(lap.ctr)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatMicro(lap.costMicro)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPer(lap.cpcMicro)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{lap.leads}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPer(lap.cplMicro)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{lap.sales}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPer(lap.cpsMicro)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums" data-testid="lap-rank">
                  {lap.rank ?? "–"}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-xs text-neutral-600">
                  {formatPeriod(lap.startedAt, lap.finishedAt, timezone)}
                </td>
                <td className="px-2 py-1.5">
                  <Toggle
                    checked={lap.on}
                    onChange={(next) => toggle(lap, next)}
                    label={`Lap ${lap.routeName} ${lap.on ? "on" : "off"}`}
                    name="lap-toggle"
                    disabled={!canToggle || !campaignId || pending || lap.status === "done"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
