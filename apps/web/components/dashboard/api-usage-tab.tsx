"use client";

import { countryName, flagEmoji, type SeriesRow } from "@sendex/core";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ChartFrame,
  ChartTable,
  EmptyState,
  KpiStrip,
  StackedBars,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { CodeXml } from "lucide-react";
import { formatDateTime, timeAgo } from "../../lib/format";
import { countryLabel, eur, int, monthLabel, pct } from "./format";

export interface ApiUsageProps {
  kpis: { sent: number; previews: number; clicks: number; spendMicro: number };
  perCountry: { series: string[]; rows: SeriesRow[] };
  countries: Array<{
    country: string;
    sent: number;
    previews: number;
    clicks: number;
    leads: number;
    sales: number;
    spendMicro: number;
    lastSentAt: string | null;
  }>;
  log: Array<{
    id: string;
    from: string;
    to: string;
    country: string;
    text: string;
    costMicro: number;
    status: string;
    sentAt: string;
  }>;
  apiDocsUrl: string | null;
  now: string;
}

/** The API Usage tab: KPI strip, messages per country over time, Target Countries and the send log. */
export function ApiUsageTab({ kpis, perCountry, countries, log, apiDocsUrl, now }: ApiUsageProps) {
  const nowDate = new Date(now);
  const total = countries.reduce(
    (t, c) => ({
      sent: t.sent + c.sent,
      previews: t.previews + c.previews,
      clicks: t.clicks + c.clicks,
      leads: t.leads + c.leads,
      sales: t.sales + c.sales,
      spendMicro: t.spendMicro + c.spendMicro,
    }),
    { sent: 0, previews: 0, clicks: 0, leads: 0, sales: 0, spendMicro: 0 },
  );
  const empty = kpis.sent === 0;
  return (
    <div className="space-y-4" data-testid="api-usage-tab">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Campaigns created and sent through the public API.</p>
        {apiDocsUrl ? (
          <Button variant="outline" size="sm" asChild>
            <a href={apiDocsUrl} target="_blank" rel="noreferrer">
              <CodeXml className="h-4 w-4" aria-hidden="true" /> API Documentation
            </a>
          </Button>
        ) : null}
      </div>
      <KpiStrip
        items={[
          { label: "Messages sent", value: int(kpis.sent), testId: "api-kpi-sent" },
          { label: "Previews", value: int(kpis.previews), testId: "api-kpi-previews" },
          { label: "Clicks", value: int(kpis.clicks), testId: "api-kpi-clicks" },
          {
            label: "CTR",
            value: pct(kpis.sent > 0 ? kpis.clicks / kpis.sent : 0),
            testId: "api-kpi-ctr",
          },
          { label: "Spend", value: eur(kpis.spendMicro), testId: "api-kpi-spend" },
        ]}
      />
      {empty ? (
        <Card>
          <EmptyState
            icon={<CodeXml />}
            title="No API traffic"
            hint="Campaigns created through the API will show up here once they send."
          />
        </Card>
      ) : (
        <>
          <ChartFrame
            title="API messages per country — over time"
            empty={perCountry.rows.length === 0}
            table={
              <ChartTable
                columns={["Month", ...perCountry.series.map(countryLabel)]}
                rows={perCountry.rows.map((r) => [
                  monthLabel(r.period),
                  ...perCountry.series.map((s) => int(Number(r[s] ?? 0))),
                ])}
              />
            }
            testId="chart-api-countries"
          >
            <StackedBars
              data={perCountry.rows}
              xKey="period"
              xFormat={monthLabel}
              series={perCountry.series.map((key) => ({ key, label: countryLabel(key) }))}
            />
          </ChartFrame>
          <Card>
            <CardHeader title="Target Countries" />
            <Table data-testid="api-countries-table">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Previews</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                  <TableHead className="text-right">Signups</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead>Last sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {countries.map((c) => (
                  <TableRow key={c.country}>
                    <TableCell>
                      <span aria-hidden="true">{flagEmoji(c.country)}</span>{" "}
                      {countryName(c.country)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {int(c.sent)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {int(c.previews)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {int(c.clicks)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {pct(c.sent > 0 ? c.clicks / c.sent : 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {c.clicks > 0 ? eur(c.spendMicro / c.clicks) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {int(c.leads)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {int(c.sales)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {eur(c.spendMicro)}
                    </TableCell>
                    <TableCell className="text-muted">{timeAgo(c.lastSentAt, nowDate)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-page font-semibold hover:bg-page">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {int(total.sent)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {int(total.previews)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {int(total.clicks)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {pct(total.sent > 0 ? total.clicks / total.sent : 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {total.clicks > 0 ? eur(total.spendMicro / total.clicks) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {int(total.leads)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {int(total.sales)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {eur(total.spendMicro)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="API SMS send log" note="latest 50" />
            <Table data-testid="api-log-table">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Text</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.from}</TableCell>
                    <TableCell className="font-mono text-xs">{m.to}</TableCell>
                    <TableCell>
                      <span aria-hidden="true">{flagEmoji(m.country)}</span> {m.country}
                    </TableCell>
                    <TableCell className="max-w-[24rem] truncate" title={m.text}>
                      {m.text}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {eur(m.costMicro)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          m.status === "delivered"
                            ? "success"
                            : m.status === "sent"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {m.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted">{formatDateTime(m.sentAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
