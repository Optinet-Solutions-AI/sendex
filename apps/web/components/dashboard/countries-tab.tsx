"use client";

import { countryName, countryStatus, flagEmoji, type SeriesRow } from "@sendex/core";
import {
  Badge,
  Card,
  CardHeader,
  ChartFrame,
  ChartTable,
  StackedArea,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  UtilisationScatter,
} from "@sendex/ui";
import { timeAgo } from "../../lib/format";
import { countryLabel, eur, int, monthLabel, pct } from "./format";

export interface CountryRowView {
  country: string;
  contacts: number;
  sent: number;
  clicks: number;
  leads: number;
  sales: number;
  costMicro: number;
  lastSentAt: string | null;
  uniqueSignups: number;
  uniqueBuyers: number;
}

export interface CountriesTabProps {
  rows: CountryRowView[];
  signups: { series: string[]; rows: SeriesRow[]; total: number };
  buyers: { series: string[]; rows: SeriesRow[]; total: number };
  insights: {
    opportunity: { country: string; contacts: number; utilisation: number } | null;
    economics: Array<{ country: string; cpsMicro: number }>;
  };
  now: string;
}

function utilisation(r: CountryRowView): number {
  return r.contacts > 0 ? r.sent / r.contacts : 0;
}

/**
 * The Countries tab: the utilisation map (contacts vs sends over contacts, coloured by cost
 * per FTD), unique signups and buyers accumulated over time, the per-country table with
 * Healthy / Under-worked badges and the two insight cards.
 */
export function CountriesTab({ rows, signups, buyers, insights, now }: CountriesTabProps) {
  const points = rows
    .filter((r) => r.contacts > 0)
    .map((r) => ({
      x: r.contacts,
      y: utilisation(r),
      label: countryName(r.country),
      colorValue: r.sales > 0 ? r.costMicro / r.sales : null,
    }));
  const nowDate = new Date(now);
  return (
    <div className="space-y-4" data-testid="countries-tab">
      <ChartFrame
        title="Utilisation map — pool size vs how hard it's worked"
        subtitle="X: contacts on file · Y: sends ÷ contacts (dashed line at 100%) · colour: cost per FTD, grey = no sales."
        empty={points.length === 0}
        table={
          <ChartTable
            columns={["Country", "Contacts", "Utilisation", "Cost / FTD"]}
            rows={points.map((p) => [p.label, int(p.x), pct(p.y, 0), eur(p.colorValue)])}
          />
        }
        testId="chart-utilisation"
      >
        <UtilisationScatter
          points={points}
          xLabel="contacts on file"
          yLabel="utilisation"
          colorLabel="cost per FTD"
          formatColor={(v) => eur(v)}
        />
      </ChartFrame>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Unique signups — accumulated over time"
          subtitle={`${int(signups.total)} unique signups in view`}
          empty={signups.rows.length === 0}
          table={
            <ChartTable
              columns={["Month", ...signups.series.map(countryLabel)]}
              rows={signups.rows.map((r) => [
                monthLabel(r.period),
                ...signups.series.map((s) => int(Number(r[s] ?? 0))),
              ])}
            />
          }
          testId="chart-signups"
        >
          <StackedArea
            data={signups.rows}
            xKey="period"
            xFormat={monthLabel}
            series={signups.series.map((key) => ({ key, label: countryLabel(key) }))}
          />
        </ChartFrame>
        <ChartFrame
          title="Unique buyers — accumulated over time"
          subtitle={`${int(buyers.total)} unique buyers in view`}
          empty={buyers.rows.length === 0}
          table={
            <ChartTable
              columns={["Month", ...buyers.series.map(countryLabel)]}
              rows={buyers.rows.map((r) => [
                monthLabel(r.period),
                ...buyers.series.map((s) => int(Number(r[s] ?? 0))),
              ])}
            />
          }
          testId="chart-buyers"
        >
          <StackedArea
            data={buyers.rows}
            xKey="period"
            xFormat={monthLabel}
            series={buyers.series.map((key) => ({ key, label: countryLabel(key) }))}
          />
        </ChartFrame>
      </div>

      <Card>
        <CardHeader title="Per-country breakdown" note={`${rows.length} countries`} />
        <Table data-testid="countries-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Country</TableHead>
              <TableHead className="text-right">Contacts</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">Utilisation</TableHead>
              <TableHead className="text-right">Signups</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Cost / sale</TableHead>
              <TableHead>Last sent</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted">
                  No contacts or sends yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const u = utilisation(r);
                const status = countryStatus(u);
                return (
                  <TableRow key={r.country} data-testid="country-row" data-country={r.country}>
                    <TableCell>
                      <span aria-hidden="true">{flagEmoji(r.country)}</span>{" "}
                      {countryName(r.country)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.contacts)}</TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.sent)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(r.sent > 0 ? r.clicks / r.sent : 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(u, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {int(r.uniqueSignups)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.sales)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.sales > 0 ? eur(r.costMicro / r.sales) : "—"}
                    </TableCell>
                    <TableCell className="text-muted">{timeAgo(r.lastSentAt, nowDate)}</TableCell>
                    <TableCell>
                      {status === "healthy" ? (
                        <Badge variant="active" data-status="healthy">
                          Healthy
                        </Badge>
                      ) : (
                        <Badge variant="amber" data-status="under-worked">
                          Under-worked
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4" data-testid="insight-opportunity">
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            Biggest opportunity — unused pool
          </div>
          {insights.opportunity ? (
            <p className="mt-2 text-sm text-ink">
              <span className="font-semibold">{countryName(insights.opportunity.country)}</span>:{" "}
              {int(insights.opportunity.contacts)} contacts,{" "}
              {pct(insights.opportunity.utilisation, 0)} used. Sending to the rest costs nothing you
              have not already paid for.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">Every country is worked at 50% or more.</p>
          )}
        </Card>
        <Card className="p-4" data-testid="insight-economics">
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            Review economics
          </div>
          {insights.economics.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No sales yet, so no cost per sale to review.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {insights.economics.slice(0, 4).map((e) => (
                <li key={e.country} className="flex items-center justify-between">
                  <span>
                    <span aria-hidden="true">{flagEmoji(e.country)}</span> {countryName(e.country)}
                  </span>
                  <span className="font-mono tabular-nums">{eur(e.cpsMicro)} per sale</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
