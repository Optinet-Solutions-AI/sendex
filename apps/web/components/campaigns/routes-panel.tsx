"use client";

import { countryName, type RouteResult } from "@sendex/core";
import { Badge, Button, EmptyState, SegmentedControl, Tooltip } from "@sendex/ui";
import { Radio, Zap } from "lucide-react";
import { useState } from "react";
import { formatMicro, formatPer, formatPercent, formatPricePerSms } from "./format";
import type { PerformancePeriodView, RoutePerformanceView, RouteView } from "./types";

const PERIODS: ReadonlyArray<{ value: PerformancePeriodView; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const TH =
  "whitespace-nowrap px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted";
const TD = "whitespace-nowrap px-3 py-1.5 text-sm";
const NUM = `${TD} text-right font-mono tabular-nums`;

/** "100 sent · 0 clicks" for a route that has sent in this campaign; nothing before that. */
function RouteResultNote({ name, result }: { name: string; result: RouteResult | undefined }) {
  if (!result || result.sent === 0) return null;
  const count = (n: number, word: string) =>
    `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;
  return (
    <span className="text-xs text-muted" data-testid={`route-result-${name}`}>
      {result.sent.toLocaleString("en-GB")} sent · {count(result.clicks, "click")}
      {result.running ? " · still sending" : ""}
    </span>
  );
}

function rank(value: number | null): string {
  return value === null ? "–" : String(value);
}

/**
 * The Routes context tab of the spec: the route picker (a checkbox row per route priced for
 * the campaign country with "Route 405 €0.0250", and what the route did in this campaign once
 * it has sent), "Remove n routes with no clicks" after a test (D4-18), then
 * "{Country} Routes Performance" with
 * Connect New SMS Route, Platform Statistics (CTR, CPC and overall ranks, Daily | Weekly |
 * Monthly) and Account Statistics (the organisation's own cost, sent, clicks, CTR, CPC).
 */
export function RoutesPanel({
  routes,
  selected,
  onChange,
  performance,
  results = [],
  zeroClick = [],
}: {
  routes: RouteView[];
  selected: readonly string[];
  onChange: (routeIds: string[]) => void;
  performance?: RoutePerformanceView;
  /** What each route sent and got in this campaign (`routeResults` over its laps). */
  results?: readonly RouteResult[];
  /** Picked routes that sent, finished and got no click (`zeroClickRouteIds`). */
  zeroClick?: readonly string[];
}) {
  const picked = new Set(selected);
  const resultOf = new Map(results.map((r) => [r.routeId, r]));
  const drop = new Set(zeroClick);
  const dropNames = routes
    .filter((r) => drop.has(r.id))
    .map((r) => (r.platform ? `Route ${r.name}` : r.name));
  const [platformPeriod, setPlatformPeriod] = useState<PerformancePeriodView>("daily");
  const [accountPeriod, setAccountPeriod] = useState<PerformancePeriodView>("daily");
  function toggle(id: string, checked: boolean) {
    const next = new Set(picked);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(routes.filter((r) => next.has(r.id)).map((r) => r.id));
  }
  return (
    <div className="space-y-5" data-testid="routes-panel">
      <div className="space-y-3">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Routes</h4>
        {dropNames.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber">
            <span className="min-w-0 flex-1">
              No clicks in this campaign: {dropNames.join(", ")}.
            </span>
            <Button
              variant="outline"
              size="sm"
              data-testid="drop-zero-click"
              onClick={() => onChange(selected.filter((id) => !drop.has(id)))}
            >
              Remove {dropNames.length} route{dropNames.length === 1 ? "" : "s"} with no clicks
            </Button>
          </div>
        ) : null}
        {routes.length === 0 ? (
          <EmptyState
            icon={<Radio />}
            title="No routes for this country"
            hint="No route is priced for this country yet."
          />
        ) : (
          <ul className="divide-y divide-rule rounded-md border border-rule bg-surface">
            {routes.map((route) => (
              <li key={route.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-neutral-50">
                  <input
                    type="checkbox"
                    checked={picked.has(route.id)}
                    disabled={route.priceMicro === null}
                    onChange={(e) => toggle(route.id, e.target.checked)}
                    data-testid={`route-${route.name}`}
                  />
                  <span className="font-medium text-ink">
                    {route.platform ? `Route ${route.name}` : route.name}
                  </span>
                  {!route.platform ? <Badge variant="code">{route.provider}</Badge> : null}
                  <RouteResultNote name={route.name} result={resultOf.get(route.id)} />
                  <span className="ml-auto font-mono text-xs text-muted">
                    {route.priceMicro === null ? (
                      <Badge variant="amber">No pricing</Badge>
                    ) : (
                      formatPricePerSms(route.priceMicro)
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {performance ? (
        <section className="space-y-4" data-testid="routes-performance">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">
              {countryName(performance.country)} Routes Performance
            </h4>
            <Tooltip content="Custom SMPP and HTTP routes arrive with the routes phase">
              <span>
                <Button variant="outline" size="sm" disabled>
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" /> Connect New SMS Route
                </Button>
              </span>
            </Tooltip>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Platform Statistics
              </h5>
              <SegmentedControl
                label="Platform statistics period"
                size="sm"
                value={platformPeriod}
                options={PERIODS}
                onChange={setPlatformPeriod}
              />
            </div>
            <div className="overflow-x-auto rounded-md border border-rule bg-surface">
              <table className="w-full text-sm" data-testid="platform-statistics">
                <thead className="border-b border-rule bg-page">
                  <tr>
                    <th className={TH}>Route</th>
                    <th className={`${TH} text-right`}>Price</th>
                    <th className={`${TH} text-right`}>CTR Rank</th>
                    <th className={`${TH} text-right`}>CPC Rank</th>
                    <th className={`${TH} text-right`}>Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.platform[platformPeriod].length === 0 ? (
                    <tr>
                      <td colSpan={5} className={`${TD} text-muted`}>
                        No platform route is priced for this country.
                      </td>
                    </tr>
                  ) : (
                    performance.platform[platformPeriod].map((r) => (
                      <tr
                        key={r.routeId}
                        className="border-t border-rule"
                        data-testid="platform-rank-row"
                        data-route={r.name}
                      >
                        <td className={`${TD} font-medium`}>Route {r.name}</td>
                        <td className={NUM}>{formatPricePerSms(r.priceMicro)}</td>
                        <td className={NUM}>{rank(r.ctrRank)}</td>
                        <td className={NUM}>{rank(r.cpcRank)}</td>
                        <td className={`${NUM} font-semibold text-ink`}>{rank(r.overallRank)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">
              Rank 1 = best performing route on the platform for this country.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Account Statistics
              </h5>
              <SegmentedControl
                label="Account statistics period"
                size="sm"
                value={accountPeriod}
                options={PERIODS}
                onChange={setAccountPeriod}
              />
            </div>
            <div className="overflow-x-auto rounded-md border border-rule bg-surface">
              <table className="w-full text-sm" data-testid="account-statistics">
                <thead className="border-b border-rule bg-page">
                  <tr>
                    <th className={TH}>Route</th>
                    <th className={`${TH} text-right`}>Price</th>
                    <th className={`${TH} text-right`}>Cost</th>
                    <th className={`${TH} text-right`}>Sent</th>
                    <th className={`${TH} text-right`}>Clicks</th>
                    <th className={`${TH} text-right`}>CTR</th>
                    <th className={`${TH} text-right`}>CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.account[accountPeriod].map((r) => (
                    <tr
                      key={r.routeId}
                      className="border-t border-rule"
                      data-testid="account-stat-row"
                      data-route={r.name}
                    >
                      <td className={`${TD} font-medium`}>Route {r.name}</td>
                      <td className={NUM}>{formatPricePerSms(r.priceMicro)}</td>
                      <td className={NUM}>{formatMicro(r.costMicro)}</td>
                      <td className={NUM}>{r.sent.toLocaleString("en-GB")}</td>
                      <td className={NUM}>{r.clicks.toLocaleString("en-GB")}</td>
                      <td className={NUM}>{formatPercent(r.ctr)}</td>
                      <td className={NUM}>{formatPer(r.cpcMicro)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
