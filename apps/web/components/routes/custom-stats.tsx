"use client";

import { countryName, flagEmoji } from "@sendex/core";
import {
  Button,
  Card,
  CardHeader,
  cn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { formatDateTime } from "../../lib/format";
import { type RoutesQuery, routesQueryString } from "../../lib/routes-params";
import { eur, int, pct } from "../dashboard/format";

export interface StatsView {
  queryMs: number;
  sending: Array<{
    routeId: string;
    routeName: string;
    country: string | null;
    sent: number;
    delivered: number;
    clicks: number;
  }>;
  byCountry: boolean;
  log: Array<{
    id: string;
    at: string;
    routeName: string;
    country: string;
    recipient: string;
    text: string;
    status: string;
    costMicro: number;
  }>;
  events: Array<{
    id: string;
    at: string;
    event: string;
    source: string;
    host: string;
    latencyMs: number | null;
    error: string | null;
  }>;
  routes: Array<{ id: string; name: string }>;
  selectedRoute: string;
}

/** Stats: Sending Statistics (group by route, + country), the SMS Log and the SMPP Connection History. */
export function CustomStats({ query, stats }: { query: RoutesQuery; stats: StatsView }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const go = (next: Partial<RoutesQuery>) =>
    router.push(`/routes/custom${routesQueryString({ ...query, ...next })}`);
  const refresh = (
    <Button variant="outline" size="sm" onClick={() => startRefresh(() => router.refresh())}>
      <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden="true" />{" "}
      Refresh
    </Button>
  );
  const periodSelect = (
    <select
      aria-label="Period"
      className="h-8 rounded-md border border-rule bg-surface px-2 text-xs"
      value={query.range}
      onChange={(e) => go({ range: e.target.value as RoutesQuery["range"] })}
    >
      <option value="7d">7 days</option>
      <option value="30d">30 days</option>
      <option value="90d">90 days</option>
      <option value="all">All time</option>
    </select>
  );
  return (
    <div className="space-y-4" data-testid="custom-stats">
      <Card>
        <CardHeader
          title="Sending Statistics"
          note={`${stats.queryMs}ms`}
          actions={
            <>
              {periodSelect}
              {refresh}
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-xs">
          <span className="font-mono uppercase tracking-[0.06em] text-muted">Group by</span>
          <span className="rounded-full border border-rule bg-page px-2 py-0.5">Route</span>
          <span className="font-mono uppercase tracking-[0.06em] text-muted">Add</span>
          <button
            type="button"
            onClick={() => go({ showLow: !stats.byCountry })}
            className={`rounded-full border px-2 py-0.5 ${stats.byCountry ? "border-navy bg-navy-soft" : "border-dashed border-neutral-400 text-muted"}`}
            data-testid="stats-add-country"
          >
            Country
          </button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Route</TableHead>
              {stats.byCountry ? <TableHead>Country</TableHead> : null}
              <TableHead className="text-right">Sent ↓</TableHead>
              <TableHead className="text-right">Delivered</TableHead>
              <TableHead className="text-right">DLR %</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">CTR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.sending.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={stats.byCountry ? 7 : 6}
                  className="py-8 text-center text-muted"
                >
                  No sending data for the selected period.
                </TableCell>
              </TableRow>
            ) : (
              stats.sending.map((r) => (
                <TableRow key={`${r.routeId}:${r.country ?? ""}`}>
                  <TableCell className="font-medium">{r.routeName}</TableCell>
                  {stats.byCountry ? (
                    <TableCell>
                      {r.country ? (
                        <>
                          <span aria-hidden="true">{flagEmoji(r.country)}</span>{" "}
                          {countryName(r.country)}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right font-mono tabular-nums">{int(r.sent)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {int(r.delivered)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {pct(r.sent > 0 ? r.delivered / r.sent : 0, 1)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {int(r.clicks)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {pct(r.sent > 0 ? r.clicks / r.sent : 0)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="SMS Log"
          note="Most recent sends"
          actions={
            <>
              <select
                aria-label="Route"
                className="h-8 rounded-md border border-rule bg-surface px-2 text-xs"
                value={stats.selectedRoute}
                onChange={(e) => go({ routes: e.target.value ? [e.target.value] : [] })}
              >
                <option value="">All routes</option>
                {stats.routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {periodSelect}
              {refresh}
            </>
          }
        />
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Text</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.log.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted">
                  No messages in the selected period.
                </TableCell>
              </TableRow>
            ) : (
              stats.log.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-muted">{formatDateTime(m.at)}</TableCell>
                  <TableCell>{m.routeName}</TableCell>
                  <TableCell>{m.country}</TableCell>
                  <TableCell className="font-mono text-xs">{m.recipient}</TableCell>
                  <TableCell className="max-w-[20rem] truncate" title={m.text}>
                    {m.text}
                  </TableCell>
                  <TableCell>{m.status}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {eur(m.costMicro)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="SMPP Connection History"
          note="Bind attempts (API does not hold persistent connections)"
          actions={
            <>
              <select
                aria-label="Connection route"
                className="h-8 rounded-md border border-rule bg-surface px-2 text-xs"
                value={stats.selectedRoute}
                onChange={(e) => go({ routes: e.target.value ? [e.target.value] : [] })}
              >
                <option value="">Pick a route</option>
                {stats.routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {refresh}
            </>
          }
        />
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Host</TableHead>
              <TableHead className="text-right">Latency</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted">
                  No connection attempts yet. Use Test Connection on a route to record one.
                </TableCell>
              </TableRow>
            ) : (
              stats.events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted">{formatDateTime(e.at)}</TableCell>
                  <TableCell className="font-mono text-xs">{e.event}</TableCell>
                  <TableCell>{e.source}</TableCell>
                  <TableCell className="font-mono text-xs">{e.host}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {e.latencyMs === null ? "—" : `${e.latencyMs} ms`}
                  </TableCell>
                  <TableCell className="text-signal">{e.error ?? ""}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
