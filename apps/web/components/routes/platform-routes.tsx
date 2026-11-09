"use client";

import { countryName, flagEmoji } from "@sendex/core";
import {
  Card,
  CardHeader,
  KpiStrip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { describeRouteRange, type RoutesQuery } from "../../lib/routes-params";
import { eur, int, pct } from "../dashboard/format";
import { RoutesFilterBar } from "./filters";

export interface CatalogueRow {
  routeId: string;
  name: string;
  country: string;
  priceMicro: number;
}

export interface DeliveryRow {
  country: string;
  routeId: string;
  routeName: string;
  priceMicro: number | null;
  sent: number;
  clicks: number;
  costMicro: number;
}

function price4(micro: number): string {
  return `€${(micro / 1_000_000).toFixed(4)}`;
}

/**
 * Platform Routes: the KPI strip, "Available Routes" (route · country · price, A→Z by
 * country) and the "Delivery Report" (country · gateway · sent · clicks · CTR · cost · CPC).
 */
export function PlatformRoutes({
  query,
  catalogue,
  report,
}: {
  query: RoutesQuery;
  catalogue: CatalogueRow[];
  report: DeliveryRow[];
}) {
  const q = query.q.toLowerCase();
  const countrySet = new Set(query.countries);
  const visibleCatalogue = catalogue.filter(
    (r) =>
      (countrySet.size === 0 || countrySet.has(r.country)) &&
      (q === "" ||
        r.name.toLowerCase().includes(q) ||
        r.country.toLowerCase().includes(q) ||
        countryName(r.country).toLowerCase().includes(q)),
  );
  const sent = report.reduce((t, r) => t + r.sent, 0);
  const clicks = report.reduce((t, r) => t + r.clicks, 0);
  const cost = report.reduce((t, r) => t + r.costMicro, 0);
  const sortedCatalogue = [...visibleCatalogue].sort(
    (a, b) =>
      countryName(a.country).localeCompare(countryName(b.country)) || a.name.localeCompare(b.name),
  );
  return (
    <div className="space-y-4" data-testid="platform-routes">
      <RoutesFilterBar
        path="/routes/platform"
        query={query}
        ranges={["all", "7d", "30d", "90d", "custom"]}
        searchPlaceholder="Search route or country…"
      />
      <KpiStrip
        items={[
          {
            label: "Routes",
            value: int(new Set(visibleCatalogue.map((r) => r.routeId)).size),
            testId: "kpi-routes",
          },
          {
            label: "Countries",
            value: int(new Set(visibleCatalogue.map((r) => r.country)).size),
            testId: "kpi-countries",
          },
          { label: "Sent", value: int(sent), testId: "kpi-sent" },
          { label: "Clicks", value: int(clicks), testId: "kpi-clicks" },
          { label: "CTR", value: pct(sent > 0 ? clicks / sent : 0), testId: "kpi-ctr" },
          { label: "Total cost", value: eur(cost), testId: "kpi-cost" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex max-h-[36rem] min-w-0 flex-col" data-testid="available-routes">
          <CardHeader title="Available Routes" note={`${int(sortedCatalogue.length)} routes`} />
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Route</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCatalogue.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted">
                      No routes match.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedCatalogue.map((r) => (
                    <TableRow key={`${r.routeId}:${r.country}`} data-testid="catalogue-row">
                      <TableCell className="font-medium">Route {r.name}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted">{r.country}</span>{" "}
                        <span aria-hidden="true">{flagEmoji(r.country)}</span>{" "}
                        {countryName(r.country)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {price4(r.priceMicro)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
        <Card className="flex max-h-[36rem] min-w-0 flex-col" data-testid="delivery-report">
          <CardHeader title="Delivery Report" note={describeRouteRange(query)} />
          <div className="overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Country</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead className="text-right">Sent ↓</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted">
                      No sends on platform routes in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.map((r) => (
                    <TableRow key={`${r.routeId}:${r.country}`} data-testid="report-row">
                      <TableCell>
                        <span aria-hidden="true">{flagEmoji(r.country)}</span>{" "}
                        {countryName(r.country)}
                      </TableCell>
                      <TableCell>
                        Route {r.routeName}{" "}
                        {r.priceMicro !== null ? (
                          <span className="font-mono text-xs text-muted">
                            {price4(r.priceMicro)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {int(r.sent)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {int(r.clicks)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {pct(r.sent > 0 ? r.clicks / r.sent : 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {eur(r.costMicro)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {r.clicks > 0 ? eur(r.costMicro / r.clicks) : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
