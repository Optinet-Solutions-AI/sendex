"use client";

import { countryName } from "@sendex/core";
import { Button, Tooltip } from "@sendex/ui";
import { ShieldCheck } from "lucide-react";
import { formatNumber } from "../../lib/format";

export interface LookupRowView {
  country: string;
  total: number;
  good: number;
  hlr: number;
  mnp: number;
  unresolved: number;
  localOnly: number;
  checking: number;
  bad: number;
  blacklisted: number;
  cached: number;
  clickers: number;
  sent: number;
  clicks: number;
  ctr: number;
}

const TH =
  "whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted";
const TD = "px-3 py-2 text-right font-mono text-sm tabular-nums";

const COLUMNS: ReadonlyArray<{ key: keyof LookupRowView; label: string; tone?: string }> = [
  { key: "total", label: "Total" },
  { key: "good", label: "Good", tone: "text-good" },
  { key: "hlr", label: "HLR" },
  { key: "mnp", label: "MNP" },
  { key: "unresolved", label: "Unresolved" },
  { key: "localOnly", label: "Local only", tone: "text-amber" },
  { key: "checking", label: "Checking" },
  { key: "bad", label: "Bad", tone: "text-signal" },
  { key: "blacklisted", label: "Blacklisted" },
  { key: "cached", label: "Cached" },
  { key: "clickers", label: "Clickers" },
  { key: "sent", label: "Sent" },
  { key: "clicks", label: "Clicks" },
];

function totals(rows: LookupRowView[]): LookupRowView {
  const sum = (key: keyof LookupRowView) => rows.reduce((n, r) => n + Number(r[key]), 0);
  const sent = sum("sent");
  const clicks = sum("clicks");
  return {
    country: "All Countries",
    total: sum("total"),
    good: sum("good"),
    hlr: sum("hlr"),
    mnp: sum("mnp"),
    unresolved: sum("unresolved"),
    localOnly: sum("localOnly"),
    checking: sum("checking"),
    bad: sum("bad"),
    blacklisted: sum("blacklisted"),
    cached: sum("cached"),
    clickers: sum("clickers"),
    sent,
    clicks,
    ctr: sent > 0 ? clicks / sent : 0,
  };
}

/**
 * The Lookup tab of the spec: "Country Breakdown" with HLR Verify and a per-country table
 * ending in a bold All Countries row. HLR, MNP, local-only, checking and cached wait for a
 * lookup provider; until then every number counts as unresolved.
 */
export function LookupTab({ rows }: { rows: LookupRowView[] }) {
  const all = totals(rows);
  const render = (row: LookupRowView, bold = false) => (
    <tr
      key={row.country}
      className={`border-t border-rule ${bold ? "bg-page font-semibold" : ""}`}
      data-testid="lookup-row"
      data-country={row.country}
    >
      <td className="px-3 py-2 text-sm text-ink">
        {bold ? row.country : `${row.country} ${countryName(row.country)}`}
      </td>
      {COLUMNS.map((c) => (
        <td key={c.key} className={`${TD} ${c.tone ?? ""}`}>
          {formatNumber(Number(row[c.key]))}
        </td>
      ))}
      <td className={TD}>{(row.ctr * 100).toFixed(0)}%</td>
    </tr>
  );
  return (
    <div className="space-y-3" data-testid="lookup-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Country Breakdown</h3>
        <Tooltip content="Network lookups need an HLR provider; they arrive with the verification phase">
          <span>
            <Button variant="outline" size="sm" disabled>
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> HLR Verify
            </Button>
          </span>
        </Tooltip>
      </div>
      <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
        <table className="w-full text-sm" data-testid="lookup-table">
          <thead className="bg-page">
            <tr>
              <th className={`${TH} text-left`}>Country</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className={TH}>
                  {c.label}
                </th>
              ))}
              <th className={TH}>CTR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => render(row))}
            {render(all, true)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
