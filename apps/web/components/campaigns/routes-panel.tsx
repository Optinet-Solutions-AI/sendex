"use client";

import { countryName } from "@sendex/core";
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

function rank(value: number | null): string {
  return value === null ? "–" : String(value);
}

/**
 * The Routes context tab of the spec: the route picker (a checkbox row per route priced for
 * the campaign country with "Route 405 €0.0250"), then "{Country} Routes Performance" with
 * Connect New SMS Route, Platform Statistics (CTR, CPC and overall ranks, Daily | Weekly |
 * Monthly) and Account Statistics (the organisation's own cost, sent, clicks, CTR, CPC).
 */
export function RoutesPanel({
  routes,
  selected,
  onChange,
  performance,
}: {
  routes: RouteView[];
  selected: readonly string[];
  onChange: (routeIds: string[]) => void;
  performance?: RoutePerformanceView;
}) {
  const picked = new Set(selected);
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
