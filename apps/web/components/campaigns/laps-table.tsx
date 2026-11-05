"use client";

import {
  campaignTotals,
  formatMicro,
  formatPer,
  formatPercent,
  formatPeriod,
  shortId,
} from "./format";
import type { LapView } from "./types";
import { StatusBadge } from "./ui";

/** "daily_message_cap" -> "daily cap" on the lap row (D3-11); other reasons as stored. */
function refusalLabel(reason: string | null): string {
  if (reason === "daily_message_cap") return "daily cap";
  if (reason === "daily_spend_cap") return "daily spend cap";
  return reason ?? "cap";
}

/** The laps queued for a campaign with their counters; shown under the send form once sent. */
export function LapsTable({ laps, timezone }: { laps: LapView[]; timezone: string }) {
  if (laps.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="laps-section">
      <h3 className="text-sm font-semibold">Laps</h3>
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm" data-testid="laps-table">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-2">Lap ID</th>
              <th className="px-2 py-2">Route</th>
              <th className="px-2 py-2">List</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2 text-right">Size</th>
              <th className="px-2 py-2 text-right">Sent</th>
              <th className="px-2 py-2 text-right">Clicks</th>
              <th className="px-2 py-2 text-right">CTR</th>
              <th className="px-2 py-2 text-right">Cost</th>
              <th className="px-2 py-2 text-right">CPC</th>
              <th className="px-2 py-2 text-right">Leads</th>
              <th className="px-2 py-2 text-right">CPL</th>
              <th className="px-2 py-2 text-right">Sales</th>
              <th className="px-2 py-2 text-right">CPS</th>
              <th className="px-2 py-2 text-right">Rank</th>
              <th className="px-2 py-2">Period</th>
              <th className="px-2 py-2">On</th>
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => {
              const t = campaignTotals([lap]);
              const on = lap.status !== "cancelled";
              return (
                <tr
                  key={lap.id}
                  className="border-t border-neutral-100"
                  data-testid="lap-row"
                  data-lap-status={lap.status}
                >
                  <td className="px-2 py-1.5 font-mono text-xs text-neutral-500">
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
                  <td className="px-2 py-1.5 text-right">{lap.testSize}</td>
                  <td className="px-2 py-1.5 text-right">{lap.sent}</td>
                  <td className="px-2 py-1.5 text-right">{lap.clicks}</td>
                  <td className="px-2 py-1.5 text-right">{formatPercent(t.ctr)}</td>
                  <td className="px-2 py-1.5 text-right">{formatMicro(lap.costMicro)}</td>
                  <td className="px-2 py-1.5 text-right">{formatPer(t.cpcMicro)}</td>
                  <td className="px-2 py-1.5 text-right">{lap.leads}</td>
                  <td className="px-2 py-1.5 text-right">{formatPer(t.cplMicro)}</td>
                  <td className="px-2 py-1.5 text-right">{lap.sales}</td>
                  <td className="px-2 py-1.5 text-right">{formatPer(t.cpsMicro)}</td>
                  <td className="px-2 py-1.5 text-right">{lap.rank ?? "–"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-xs text-neutral-600">
                    {formatPeriod(lap.startedAt, lap.finishedAt, timezone)}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={on}
                      readOnly
                      disabled
                      aria-label={`Lap ${shortId(lap.id)} ${on ? "on" : "off"}`}
                      title="Pausing and cancelling laps arrives with the sending engine (D2-04)"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
