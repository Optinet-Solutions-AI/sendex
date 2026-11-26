"use client";

import { countryName, FORMULAS, flagEmoji, type SalesResultSort } from "@sendex/core";
import {
  Badge,
  Card,
  CountPill,
  cn,
  Explained,
  KpiStrip,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { ArrowDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatNumber } from "../../lib/format";
import {
  insightLabel,
  type SalesResultsQuery,
  salesResultsQueryString,
} from "../../lib/kpi-params";
import { explainLeadToSale, explainRevenue, KPI_FORMULAS } from "./explain";
import { eur, percent, shortDay } from "./format";
import { PeriodFilter } from "./period-filter";

export interface SalesResultView {
  day: string;
  offer: string;
  routeName: string;
  country: string;
  listName: string | null;
  provider: string | null;
  leads: number;
  sales: number;
  /** Micro-EUR as a string. */
  revenueMicro: string;
}

export interface SalesResultsTotals {
  leads: number;
  sales: number;
  leadToSale: number | null;
  revenueMicro: string;
}

/**
 * Sales Results (D5-05), the "FTD Results" table of the Business KPIs Manager walkthrough:
 * one line per day, offer, route, country and list with the registrations of the SMS sent
 * that day and the first deposits made that day. Nothing is typed in: it is read from the
 * postbacks, and revenue is the postback value or the offer's payout.
 */
export function SalesResults({
  query,
  thisYear,
  rows,
  totals,
}: {
  query: SalesResultsQuery;
  thisYear: number;
  rows: readonly SalesResultView[];
  totals: SalesResultsTotals;
}) {
  const router = useRouter();
  const navigate = (next: Partial<SalesResultsQuery>) =>
    router.push(`/kpi/sales-results${salesResultsQueryString({ ...query, ...next })}`, {
      scroll: false,
    });

  return (
    <section className="space-y-4" data-testid="sales-results">
      <PageHeader
        breadcrumb={[{ label: "Performance" }, { label: "Sales Results" }]}
        title="Sales Results"
        subtitle="Registrations and first deposits per day, offer, route, country and list. Filled in from the postbacks; revenue is worked out for you."
      />

      <div className="flex flex-wrap items-center gap-3" data-testid="sales-results-filters">
        <PeriodFilter query={query} thisYear={thisYear} onChange={navigate} />
        <div className="ml-auto">
          <CountPill count={rows.length} noun="row" testId="sales-results-count" />
        </div>
      </div>

      <KpiStrip
        label="Totals"
        items={[
          {
            label: <Explained formula={KPI_FORMULAS.leads}>Leads</Explained>,
            value: formatNumber(totals.leads),
            testId: "results-leads",
          },
          {
            label: <Explained formula={FORMULAS.sales}>Sales (FTD)</Explained>,
            value: formatNumber(totals.sales),
            testId: "results-sales",
          },
          {
            label: <Explained formula={FORMULAS.lts}>Lead → sale</Explained>,
            value: (
              <Explained {...explainLeadToSale(totals)}>{percent(totals.leadToSale)}</Explained>
            ),
            testId: "results-conversion",
          },
          {
            label: <Explained formula={FORMULAS.revenue}>Revenue</Explained>,
            value: <Explained {...explainRevenue(totals)}>{eur(totals.revenueMicro)}</Explained>,
            testId: "results-revenue",
          },
        ]}
      />

      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted" data-testid="sales-results-empty">
          No registration and no first deposit during {insightLabel(query)}. Pick another period.
        </Card>
      ) : (
        <Table data-testid="sales-results-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label="Date" sort="day" query={query} onSort={navigate} />
              <TableHead>Offer</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>List</TableHead>
              <TableHead>Data provider</TableHead>
              <SortHead
                label="Leads"
                formula={KPI_FORMULAS.leads}
                sort="leads"
                query={query}
                onSort={navigate}
                right
              />
              <SortHead
                label="Sales"
                formula={FORMULAS.sales}
                sort="sales"
                query={query}
                onSort={navigate}
                right
              />
              <SortHead
                label="Revenue"
                formula={FORMULAS.revenue}
                sort="revenue"
                query={query}
                onSort={navigate}
                right
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={`${r.day}:${r.offer}:${r.routeName}:${r.country}:${r.listName ?? ""}`}
                data-testid="sales-result-row"
              >
                <TableCell className="whitespace-nowrap" data-col="day">
                  {shortDay(`${r.day}T00:00:00Z`)}
                </TableCell>
                <TableCell>{r.offer}</TableCell>
                <TableCell>{r.routeName ? `Route ${r.routeName}` : "–"}</TableCell>
                <TableCell>
                  {flagEmoji(r.country)} {countryName(r.country)}
                </TableCell>
                <TableCell>{r.listName ?? "–"}</TableCell>
                <TableCell>
                  {r.provider ? <Badge variant="code">{r.provider}</Badge> : "–"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums" data-col="leads">
                  {formatNumber(r.leads)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums" data-col="sales">
                  {formatNumber(r.sales)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums" data-col="revenue">
                  <Explained {...explainRevenue(r)}>{eur(r.revenueMicro)}</Explained>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** A column header that orders the table by its column, largest or latest first. */
function SortHead({
  label,
  formula,
  sort,
  query,
  onSort,
  right = false,
}: {
  label: string;
  /** How the column's figure is worked out (D5-20), shown on hover. */
  formula?: string;
  sort: SalesResultSort;
  query: SalesResultsQuery;
  onSort: (next: Partial<SalesResultsQuery>) => void;
  right?: boolean;
}) {
  const active = query.sort === sort;
  return (
    <TableHead className={cn(right && "text-right")} aria-sort={active ? "descending" : "none"}>
      <button
        type="button"
        onClick={() => onSort({ sort })}
        className={cn(
          "inline-flex items-center gap-1 uppercase hover:text-ink",
          active && "text-ink",
        )}
        data-testid={`sort-${sort}`}
      >
        <Explained formula={formula} inButton>
          {label}
        </Explained>
        {active ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : null}
      </button>
    </TableHead>
  );
}
