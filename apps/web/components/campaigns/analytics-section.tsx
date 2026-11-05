import { formatDateTime, formatMicro, formatPercent } from "./format";
import type { CampaignResultsView } from "./types";

/**
 * The Analytics tab of the results page (D3-05): networks (the breakdown per route and
 * provider, counted from the message table), clicks per hour since the first send and clicks
 * per tracked link (both from the click table). Conversions keep their own section.
 */

function NetworksTable({ results }: { results: CampaignResultsView }) {
  const rows = results.networks.rows;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Networks</h4>
      <p className="text-xs text-neutral-500" data-testid="networks-note">
        Messages do not record the mobile operator yet, so this is the breakdown by route and
        provider, counted from the message table.
      </p>
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm" data-testid="networks-table">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-2">Route</th>
              <th className="px-2 py-2">Provider</th>
              <th className="px-2 py-2 text-right">Sent</th>
              <th className="px-2 py-2 text-right">Delivered</th>
              <th className="px-2 py-2 text-right">Delivery rate</th>
              <th className="px-2 py-2 text-right">Failed</th>
              <th className="px-2 py-2 text-right">Clicks</th>
              <th className="px-2 py-2 text-right">CTR</th>
              <th className="px-2 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-2 py-4 text-center text-neutral-500">
                  Nothing sent yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.routeId}
                  className="border-t border-neutral-100"
                  data-testid="network-row"
                  data-route={r.name}
                >
                  <td className="px-2 py-1.5 font-medium">{r.name}</td>
                  <td className="px-2 py-1.5 text-neutral-600">{r.provider}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.sent}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.delivered}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatPercent(r.deliveryRate)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.failed}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.clicks}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatPercent(r.ctr)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatMicro(r.costMicro)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One series, so one hue and no legend: each row is the hour, a bar and the count. */
function ClicksPerHour({ results, timezone }: { results: CampaignResultsView; timezone: string }) {
  const buckets = results.clicksPerHour;
  const max = buckets.reduce((m, b) => Math.max(m, b.clicks), 0);
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Clicks per hour since the first send</h4>
      {buckets.length === 0 || !results.firstSentAt ? (
        <p className="text-sm text-neutral-500" data-testid="clicks-per-hour-empty">
          No clicks yet.
        </p>
      ) : (
        <div className="rounded border border-neutral-200 bg-white p-3">
          <p className="mb-2 text-xs text-neutral-500">
            First send {formatDateTime(results.firstSentAt, timezone)} · hour 0 starts there.
          </p>
          <ol className="space-y-1" data-testid="clicks-per-hour">
            {buckets.map((b) => (
              <li
                key={b.hour}
                className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs"
                data-testid="clicks-hour"
                data-hour={b.hour}
                title={`Hour ${b.hour} (${formatDateTime(b.at, timezone)}): ${b.clicks} clicks`}
              >
                <span className="text-neutral-600">
                  Hour {b.hour} · {formatDateTime(b.at, timezone).slice(-5)}
                </span>
                <span className="h-3 rounded-r-sm bg-neutral-100">
                  <span
                    className="block h-3 rounded-r-sm bg-emerald-500"
                    style={{ width: `${max > 0 ? Math.max(2, (b.clicks / max) * 100) : 0}%` }}
                  />
                </span>
                <span className="text-right tabular-nums" data-testid="clicks-hour-count">
                  {b.clicks}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ClicksPerLink({ results }: { results: CampaignResultsView }) {
  const rows = results.clicksPerLink;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Clicks per link</h4>
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm" data-testid="clicks-per-link">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-2">Link</th>
              <th className="px-2 py-2">URL</th>
              <th className="px-2 py-2 text-right">Sent</th>
              <th className="px-2 py-2 text-right">Clicks</th>
              <th className="px-2 py-2 text-right">CTR</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-neutral-500">
                  Nothing sent yet.
                </td>
              </tr>
            ) : (
              rows.map((l) => (
                <tr
                  key={l.linkId ?? "none"}
                  className="border-t border-neutral-100"
                  data-testid="link-row"
                >
                  <td className="px-2 py-1.5 font-medium">{l.name}</td>
                  <td
                    className="max-w-md truncate px-2 py-1.5 text-xs text-neutral-600"
                    title={l.url ?? ""}
                  >
                    {l.url ?? "–"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.sent}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.clicks}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatPercent(l.ctr)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AnalyticsSection({
  results,
  timezone,
}: {
  results: CampaignResultsView;
  timezone: string;
}) {
  return (
    <section className="space-y-6" data-testid="analytics-section">
      <NetworksTable results={results} />
      <ClicksPerHour results={results} timezone={timezone} />
      <ClicksPerLink results={results} />
    </section>
  );
}
