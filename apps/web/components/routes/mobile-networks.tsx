"use client";

import { countryName, flagEmoji, type MobileNetworksView, NETWORK_MIN_SENT } from "@sendex/core";
import {
  Card,
  cn,
  KpiStrip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { type RoutesQuery, routesQueryString } from "../../lib/routes-params";
import { int, pct } from "../dashboard/format";
import { RoutesFilterBar } from "./filters";

export interface MobileNetworksProps {
  query: RoutesQuery;
  view: MobileNetworksView;
  routes: Array<{ id: string; name: string }>;
}

/** Mobile Networks: KPIs, the low-volume note and one collapsible card per country with operator rows that expand into their routes. */
export function MobileNetworks({ query, view, routes }: MobileNetworksProps) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleSet = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const routeSelect = (
    <select
      aria-label="Routes"
      className="h-9 rounded-md border border-neutral-300 bg-surface px-3 text-sm"
      value={query.routes[0] ?? ""}
      onChange={(e) => {
        const value = e.target.value;
        window.location.href = `/routes/mobile-networks${routesQueryString({ ...query, routes: value ? [value] : [] }, "30d")}`;
      }}
    >
      <option value="">All routes</option>
      {routes.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
  return (
    <div className="space-y-4" data-testid="mobile-networks">
      <RoutesFilterBar
        path="/routes/mobile-networks"
        query={query}
        ranges={["7d", "30d", "90d", "custom"]}
        defaultRange="30d"
        searchPlaceholder="Search operator or country…"
        extra={routeSelect}
      />
      <KpiStrip
        items={[
          { label: "Countries", value: int(view.kpis.countries), testId: "net-kpi-countries" },
          { label: "Networks", value: int(view.kpis.networks), testId: "net-kpi-networks" },
          { label: "Sent", value: int(view.kpis.sent), testId: "net-kpi-sent" },
          { label: "Clicks", value: int(view.kpis.clicks) },
          { label: "CTR", value: pct(view.kpis.ctr) },
          { label: "Leads", value: int(view.kpis.leads) },
          { label: "Sales", value: int(view.kpis.sales) },
        ]}
      />
      <p className="flex flex-wrap items-center gap-1 text-sm text-muted">
        <Info className="h-3.5 w-3.5" aria-hidden="true" /> CTR is only meaningful above{" "}
        {NETWORK_MIN_SENT} messages. Operators below that are hidden.{" "}
        {view.hiddenCount > 0 || query.showLow ? (
          <Link
            href={`/routes/mobile-networks${routesQueryString({ ...query, showLow: !query.showLow }, "30d")}`}
            className="text-navy underline-offset-2 hover:underline"
            data-testid="toggle-low-volume"
          >
            {query.showLow
              ? "Hide low-volume networks"
              : `Show low-volume networks (${view.hiddenCount})`}
          </Link>
        ) : null}
      </p>
      {view.countries.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">
          No sends with a known operator in this period.
        </Card>
      ) : (
        view.countries.map((c) => {
          const isClosed = closed.has(c.country);
          return (
            <Card key={c.country} data-testid="network-country" data-country={c.country}>
              <button
                type="button"
                onClick={() => setClosed((s) => toggleSet(s, c.country))}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
                aria-expanded={!isClosed}
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                  {isClosed ? (
                    <ChevronRight className="h-4 w-4 text-muted" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted" aria-hidden="true" />
                  )}
                  <span className="font-mono text-xs text-muted">{c.country}</span>{" "}
                  {countryName(c.country)} ·{" "}
                  <span className="font-normal text-muted">
                    {c.networks.length} {c.networks.length === 1 ? "network" : "networks"}
                  </span>
                </span>
                <span className="text-sm text-muted">
                  Sent <span className="font-mono text-ink">{int(c.sent)}</span> · Country CTR{" "}
                  <span className="font-mono text-ink">{pct(c.ctr)}</span>
                </span>
              </button>
              {isClosed ? null : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Operator</TableHead>
                      <TableHead className="text-right">Sent ↓</TableHead>
                      <TableHead className="text-right">Previews</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead>Share of Country</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.networks.map((n) => {
                      const key = `${c.country}:${n.operator}`;
                      const expanded = open.has(key);
                      const delta = n.ctrDelta * 100;
                      return (
                        <RowGroup key={key}>
                          <TableRow
                            data-testid="network-row"
                            data-operator={n.operator}
                            className={n.lowVolume ? "opacity-70" : ""}
                          >
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => setOpen((s) => toggleSet(s, key))}
                                className="inline-flex items-center gap-1 hover:underline"
                                aria-expanded={expanded}
                              >
                                {expanded ? (
                                  <ChevronDown
                                    className="h-3.5 w-3.5 text-muted"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <ChevronRight
                                    className="h-3.5 w-3.5 text-muted"
                                    aria-hidden="true"
                                  />
                                )}
                                {n.operator}
                              </button>
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {int(n.sent)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {int(n.previews)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {int(n.clicks)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {pct(n.ctr)}{" "}
                              <span
                                className={cn("text-xs", delta >= 0 ? "text-good" : "text-signal")}
                              >
                                {delta >= 0 ? "+" : "−"}
                                {Math.abs(delta).toFixed(1)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {int(n.leads)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {int(n.sales)}
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-2">
                                <span className="h-1.5 w-24 rounded bg-neutral-200">
                                  <span
                                    className="block h-1.5 rounded bg-navy"
                                    style={{ width: `${Math.round(n.share * 100)}%` }}
                                  />
                                </span>
                                <span className="font-mono text-xs tabular-nums">
                                  {pct(n.share, 1)}
                                </span>
                              </span>
                            </TableCell>
                          </TableRow>
                          {expanded ? (
                            <TableRow
                              className="bg-page hover:bg-page"
                              data-testid="network-routes"
                            >
                              <TableCell colSpan={8}>
                                <div className="mb-1 text-xs font-semibold text-ink">
                                  📶 Routes carrying {n.operator}
                                </div>
                                <table className="w-full text-xs">
                                  <thead className="text-left font-mono text-[11px] uppercase text-muted">
                                    <tr>
                                      <th className="py-1">Route</th>
                                      <th className="py-1 text-right">Sent</th>
                                      <th className="py-1 text-right">Clicks</th>
                                      <th className="py-1 text-right">CTR</th>
                                      <th className="py-1 text-right">Leads</th>
                                      <th className="py-1 text-right">Sales</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {n.routes.map((r) => (
                                      <tr key={r.routeId}>
                                        <td className="py-0.5">Route {r.routeName}</td>
                                        <td className="py-0.5 text-right font-mono tabular-nums">
                                          {int(r.sent)}
                                        </td>
                                        <td className="py-0.5 text-right font-mono tabular-nums">
                                          {int(r.clicks)}
                                        </td>
                                        <td className="py-0.5 text-right font-mono tabular-nums">
                                          {pct(r.ctr)}
                                        </td>
                                        <td className="py-0.5 text-right font-mono tabular-nums">
                                          {int(r.leads)}
                                        </td>
                                        <td className="py-0.5 text-right font-mono tabular-nums">
                                          {int(r.sales)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </RowGroup>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Card>
          );
        })
      )}
      <p className="sr-only">{flagEmoji("ES")}</p>
    </div>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
