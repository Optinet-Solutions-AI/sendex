"use client";

import { countryName, DAY_RULE_NOTE, FORMULAS, flagEmoji, type SeriesRow } from "@sendex/core";
import {
  Badge,
  Card,
  CardHeader,
  ChartFrame,
  ChartTable,
  Explained,
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
import {
  ctrFigure,
  DASHBOARD_FORMULAS,
  economicsFigure,
  opportunityFigure,
  perFigure,
  statusFigure,
  utilisationFigure,
} from "./explain";
import { FigureText } from "./figure";
import { countryLabel, eur, int, monthLabel } from "./format";

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
      utilisation: utilisationFigure(r.sent, r.contacts),
      costPerSale: perFigure(
        FORMULAS.costPerSale,
        r.costMicro,
        r.sales,
        "sale",
        "cost",
        DAY_RULE_NOTE,
      ),
    }));
  const byCountry = new Map(rows.map((r) => [r.country, r]));
  const opportunityRow = insights.opportunity
    ? byCountry.get(insights.opportunity.country)
    : undefined;
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
            rows={points.map((p) => [
              p.label,
              int(p.x),
              <FigureText key="utilisation" figure={p.utilisation} />,
              <FigureText key="cost" figure={p.costPerSale} />,
            ])}
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
              <TableHead className="text-right">
                <Explained formula={DASHBOARD_FORMULAS.contactsAllTime}>Contacts</Explained>
              </TableHead>
              <TableHead className="text-right">
                <Explained formula={FORMULAS.sent}>Sent</Explained>
              </TableHead>
              <TableHead className="text-right">
                <Explained formula={FORMULAS.ctr}>CTR</Explained>
              </TableHead>
              <TableHead className="text-right">
                <Explained formula={DASHBOARD_FORMULAS.utilisation}>Utilisation</Explained>
              </TableHead>
              <TableHead className="text-right">
                <Explained formula={DASHBOARD_FORMULAS.signupsUnique}>Signups</Explained>
              </TableHead>
              <TableHead className="text-right">
                <Explained formula={FORMULAS.sales}>Sales</Explained>
              </TableHead>
              <TableHead className="text-right">
                <Explained formula={FORMULAS.costPerSale}>Cost / sale</Explained>
              </TableHead>
              <TableHead>Last sent</TableHead>
              <TableHead>
                <Explained formula={DASHBOARD_FORMULAS.status}>Status</Explained>
              </TableHead>
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
                const status = statusFigure(u);
                const healthy = status.text === "Healthy";
                return (
                  <TableRow key={r.country} data-testid="country-row" data-country={r.country}>
                    <TableCell>
                      <span aria-hidden="true">{flagEmoji(r.country)}</span>{" "}
                      {countryName(r.country)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.contacts)}</TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.sent)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <FigureText figure={ctrFigure(r.clicks, r.sent)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <FigureText figure={utilisationFigure(r.sent, r.contacts)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {int(r.uniqueSignups)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{int(r.sales)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <FigureText
                        figure={perFigure(
                          FORMULAS.costPerSale,
                          r.costMicro,
                          r.sales,
                          "sale",
                          "cost",
                          DAY_RULE_NOTE,
                        )}
                      />
                    </TableCell>
                    <TableCell className="text-muted">{timeAgo(r.lastSentAt, nowDate)}</TableCell>
                    <TableCell>
                      <Explained
                        formula={status.formula}
                        working={status.working}
                        className="no-underline"
                      >
                        {healthy ? (
                          <Badge variant="active" data-status="healthy">
                            Healthy
                          </Badge>
                        ) : (
                          <Badge variant="amber" data-status="under-worked">
                            Under-worked
                          </Badge>
                        )}
                      </Explained>
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
            <Explained formula={DASHBOARD_FORMULAS.opportunity}>
              Biggest opportunity — unused pool
            </Explained>
          </div>
          {insights.opportunity ? (
            <p className="mt-2 text-sm text-ink">
              <span className="font-semibold">{countryName(insights.opportunity.country)}</span>:{" "}
              <FigureText
                figure={opportunityFigure(
                  insights.opportunity.contacts,
                  opportunityRow?.sent ?? 0,
                  insights.opportunity.utilisation,
                )}
              />
              . Sending to the rest costs nothing you have not already paid for.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">Every country is worked at 50% or more.</p>
          )}
        </Card>
        <Card className="p-4" data-testid="insight-economics">
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            <Explained formula={DASHBOARD_FORMULAS.economics}>Review economics</Explained>
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
                  <span className="font-mono tabular-nums">
                    <FigureText
                      figure={economicsFigure(
                        byCountry.get(e.country)?.costMicro ?? 0,
                        byCountry.get(e.country)?.sales ?? 0,
                        e.cpsMicro,
                      )}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
