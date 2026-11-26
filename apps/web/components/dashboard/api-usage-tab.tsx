"use client";

import { countryName, FORMULAS, flagEmoji, type SeriesRow } from "@sendex/core";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ChartFrame,
  ChartTable,
  EmptyState,
  Explained,
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
import { ctrFigure, DASHBOARD_FORMULAS, perFigure, sumFigure } from "./explain";
import { FigureText } from "./figure";
import { countryLabel, eur, int, monthLabel } from "./format";

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
  const kpiCtr = ctrFigure(kpis.clicks, kpis.sent);
  const totalOf = (
    formula: string,
    pick: (c: (typeof countries)[number]) => string,
    result: string,
  ) => <FigureText figure={sumFigure(formula, countries.map(pick), result)} />;
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
          {
            label: <Explained formula={DASHBOARD_FORMULAS.previews}>Previews</Explained>,
            value: int(kpis.previews),
            testId: "api-kpi-previews",
          },
          {
            label: <Explained formula={FORMULAS.clicks}>Clicks</Explained>,
            value: int(kpis.clicks),
            testId: "api-kpi-clicks",
          },
          {
            label: <Explained formula={kpiCtr.formula}>CTR</Explained>,
            value: <FigureText figure={kpiCtr} />,
            testId: "api-kpi-ctr",
          },
          {
            label: <Explained formula={DASHBOARD_FORMULAS.cost}>Spend</Explained>,
            value: eur(kpis.spendMicro),
            testId: "api-kpi-spend",
          },
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
                  <TableHead className="text-right">
                    <Explained formula={FORMULAS.sent}>Sent</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={DASHBOARD_FORMULAS.previews}>Previews</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={FORMULAS.clicks}>Clicks</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={FORMULAS.ctr}>CTR</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={FORMULAS.cpc}>CPC</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={DASHBOARD_FORMULAS.signupsRaw}>Signups</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={FORMULAS.sales}>Sales</Explained>
                  </TableHead>
                  <TableHead className="text-right">
                    <Explained formula={DASHBOARD_FORMULAS.cost}>Spend</Explained>
                  </TableHead>
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
                      <FigureText figure={ctrFigure(c.clicks, c.sent)} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      <FigureText
                        figure={perFigure(FORMULAS.cpc, c.spendMicro, c.clicks, "click", "spend")}
                      />
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
                    {totalOf(DASHBOARD_FORMULAS.total, (c) => int(c.sent), int(total.sent))}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {totalOf(DASHBOARD_FORMULAS.total, (c) => int(c.previews), int(total.previews))}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {totalOf(DASHBOARD_FORMULAS.total, (c) => int(c.clicks), int(total.clicks))}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <FigureText figure={ctrFigure(total.clicks, total.sent)} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <FigureText
                      figure={perFigure(
                        FORMULAS.cpc,
                        total.spendMicro,
                        total.clicks,
                        "click",
                        "spend",
                      )}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {totalOf(DASHBOARD_FORMULAS.total, (c) => int(c.leads), int(total.leads))}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {totalOf(DASHBOARD_FORMULAS.total, (c) => int(c.sales), int(total.sales))}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {totalOf(
                      DASHBOARD_FORMULAS.total,
                      (c) => eur(c.spendMicro),
                      eur(total.spendMicro),
                    )}
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
