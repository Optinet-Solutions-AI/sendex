"use client";

import { countryName, FORMULAS, flagEmoji } from "@sendex/core";
import {
  Card,
  cn,
  Explained,
  KpiStrip,
  PageHeader,
  SegmentedControl,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sendex/ui";
import { useRouter } from "next/navigation";
import { formatNumber } from "../../lib/format";
import {
  type InsightQuery,
  type InsightSort,
  insightLabel,
  insightQueryString,
} from "../../lib/kpi-params";
import {
  type Explanation,
  explainCost,
  explainCostPerSale,
  explainLeadToSale,
  explainProfit,
  explainProfitPerSale,
  explainRevenue,
  explainRevenuePerSale,
  explainRoi,
  explainSmsPerSale,
  KPI_FORMULAS,
} from "./explain";
import { eur, percent } from "./format";
import { PeriodFilter } from "./period-filter";

export interface InsightTotalsView {
  sent: number;
  leads: number;
  sales: number;
  costMicro: string;
  revenueMicro: string;
  profitMicro: string;
  costPerSaleMicro: string | null;
  revenuePerSaleMicro: string | null;
  profitPerSaleMicro: string | null;
  smsPerSale: number | null;
}

/** One bar of a ranked list: its label, the number that sizes the bar and how to print it. */
export interface BarItem {
  label: string;
  value: number;
  display: string;
  /** How the printed figure was worked out (D5-20), shown on hover. */
  explanation?: Explanation;
}

export interface OfferRowView {
  offer: string;
  sent: number;
  leads: number;
  sales: number;
  leadToSale: number | null;
  costMicro: string;
  revenueMicro: string;
  roi: number | null;
}

export interface CountryOffersView {
  country: string;
  sales: number;
  offers: OfferRowView[];
}

export interface EfficiencyView {
  offer: string;
  smsPerSale: number;
  sales: number;
  /** SMS the offer sent in the period, for the explanation of its SMS per sale. */
  sent: number;
}

const SORTS: ReadonlyArray<{ value: InsightSort; label: string }> = [
  { value: "roi", label: "Sort by ROI" },
  { value: "sales", label: "Sort by sales" },
];

/**
 * Performance Insight (D5-04), after the dashboard of the Business KPIs Manager walkthrough:
 * the period's sales, revenue, cost and profit, what one sale costs and brings, how many SMS
 * it takes to get one, and where the sales come from by offer and by country.
 */
export function Insight({
  query,
  thisYear,
  totals,
  offersByRoi,
  roiByCountry,
  salesByCountry,
  countries,
  efficiency,
}: {
  query: InsightQuery;
  thisYear: number;
  totals: InsightTotalsView;
  offersByRoi: readonly BarItem[];
  roiByCountry: readonly BarItem[];
  salesByCountry: readonly BarItem[];
  countries: readonly CountryOffersView[];
  efficiency: readonly EfficiencyView[];
}) {
  const router = useRouter();
  const navigate = (next: Partial<InsightQuery>) =>
    router.push(`/kpi/insight${insightQueryString({ ...query, ...next })}`, { scroll: false });
  const profit = BigInt(totals.profitMicro);
  const revenue = Number(BigInt(totals.revenueMicro));
  const cost = Number(BigInt(totals.costMicro));
  const empty = totals.sent === 0 && totals.sales === 0;

  return (
    <section className="space-y-4" data-testid="insight">
      <PageHeader
        breadcrumb={[{ label: "Performance" }, { label: "Insight" }]}
        title="Performance Insight"
        subtitle={`${insightLabel(query)}: what was sent, what it cost and what it brought.`}
      />

      <div className="flex flex-wrap items-center gap-3" data-testid="insight-filters">
        <PeriodFilter query={query} thisYear={thisYear} onChange={navigate} />
      </div>

      <KpiStrip
        label="Totals"
        items={[
          {
            label: <Explained formula={FORMULAS.sales}>Sales (FTD)</Explained>,
            value: formatNumber(totals.sales),
            testId: "insight-sales",
          },
          {
            label: <Explained formula={FORMULAS.revenue}>Revenue</Explained>,
            value: <Explained {...explainRevenue(totals)}>{eur(totals.revenueMicro)}</Explained>,
            testId: "insight-revenue",
          },
          {
            label: <Explained formula={FORMULAS.cost}>Cost</Explained>,
            value: <Explained {...explainCost(totals)}>{eur(totals.costMicro)}</Explained>,
            testId: "insight-cost",
          },
          {
            label: <Explained formula={FORMULAS.profit}>Net profit</Explained>,
            value: <Explained {...explainProfit(totals)}>{eur(totals.profitMicro)}</Explained>,
            tone: profit < 0n ? "bad" : profit > 0n ? "good" : "default",
            testId: "insight-profit",
          },
        ]}
      />
      <KpiStrip
        label="Per sale"
        items={[
          {
            label: <Explained formula={FORMULAS.costPerSale}>Cost per sale</Explained>,
            value: (
              <Explained {...explainCostPerSale(totals)}>{eur(totals.costPerSaleMicro)}</Explained>
            ),
            testId: "insight-cost-per-sale",
          },
          {
            label: <Explained formula={FORMULAS.revenuePerSale}>Revenue per sale</Explained>,
            value: (
              <Explained {...explainRevenuePerSale(totals)}>
                {eur(totals.revenuePerSaleMicro)}
              </Explained>
            ),
            testId: "insight-revenue-per-sale",
          },
          {
            label: <Explained formula={FORMULAS.smsPerSale}>SMS per sale</Explained>,
            value: (
              <Explained {...explainSmsPerSale(totals)}>
                {totals.smsPerSale === null ? "–" : formatNumber(totals.smsPerSale)}
              </Explained>
            ),
            hint: `${formatNumber(totals.sent)} SMS sent`,
            testId: "insight-sms-per-sale",
          },
          {
            label: <Explained formula={FORMULAS.profitPerSale}>Profit per sale</Explained>,
            value: (
              <Explained {...explainProfitPerSale(totals)}>
                {eur(totals.profitPerSaleMicro)}
              </Explained>
            ),
            testId: "insight-profit-per-sale",
          },
        ]}
      />

      {empty ? (
        <Card className="p-6 text-sm text-muted" data-testid="insight-empty">
          Nothing was sent and no sale came in during {insightLabel(query)}. Pick another period.
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5" data-testid="insight-revenue-cost">
              <h2 className="text-sm font-semibold text-ink">Revenue and cost</h2>
              <BarList
                className="mt-3"
                items={[
                  {
                    label: "Revenue",
                    value: revenue,
                    display: eur(totals.revenueMicro),
                    explanation: explainRevenue(totals),
                  },
                  {
                    label: "Cost",
                    value: cost,
                    display: eur(totals.costMicro),
                    explanation: explainCost(totals),
                  },
                ]}
                colors={["bg-[#1baf7a]", "bg-[#e0a030]"]}
              />
            </Card>
            <Card className="p-5" data-testid="insight-offers-roi">
              <h2 className="text-sm font-semibold text-ink">
                Top offers by <Explained formula={FORMULAS.roi}>ROI</Explained>
              </h2>
              <p className="text-xs text-muted">Profit divided by cost, best first.</p>
              <BarList className="mt-3" items={offersByRoi} />
            </Card>
            <Card className="p-5" data-testid="insight-roi-country">
              <h2 className="text-sm font-semibold text-ink">
                <Explained formula={FORMULAS.roi}>ROI</Explained> by country
              </h2>
              <BarList className="mt-3" items={roiByCountry} />
            </Card>
            <Card className="p-5" data-testid="insight-sales-country">
              <h2 className="text-sm font-semibold text-ink">
                <Explained formula={FORMULAS.sales}>Sales</Explained> by country
              </h2>
              <BarList className="mt-3" items={salesByCountry} ranked />
            </Card>
          </div>

          <Card className="p-5" data-testid="insight-by-country">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Offer performance by country</h2>
                <p className="text-xs text-muted">The five best offers of each country.</p>
              </div>
              <SegmentedControl
                label="Sort offers"
                value={query.sort}
                options={SORTS}
                onChange={(sort) => navigate({ sort })}
              />
            </div>
            <div className="mt-3 divide-y divide-rule">
              {countries.map((c, index) => (
                <details
                  key={c.country}
                  open={index === 0}
                  className="group py-2"
                  data-testid="insight-country"
                  data-country={c.country}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1 text-sm font-medium text-ink">
                    <span>
                      {flagEmoji(c.country)} {countryName(c.country)}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {formatNumber(c.sales)} {c.sales === 1 ? "sale" : "sales"}
                    </span>
                  </summary>
                  <Table className="mt-2">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Offer</TableHead>
                        <TableHead className="text-right">
                          <Explained formula={FORMULAS.sent}>Sent</Explained>
                        </TableHead>
                        <TableHead className="text-right">
                          <Explained formula={KPI_FORMULAS.leads}>Leads</Explained>
                        </TableHead>
                        <TableHead className="text-right">
                          <Explained formula={FORMULAS.sales}>Sales</Explained>
                        </TableHead>
                        <TableHead className="text-right">
                          <Explained formula={FORMULAS.lts}>Lead → sale</Explained>
                        </TableHead>
                        <TableHead className="text-right">
                          <Explained formula={FORMULAS.cost}>Cost</Explained>
                        </TableHead>
                        <TableHead className="text-right">
                          <Explained formula={FORMULAS.revenue}>Revenue</Explained>
                        </TableHead>
                        <TableHead className="text-right">
                          <Explained formula={FORMULAS.roi}>ROI</Explained>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {c.offers.map((o) => (
                        <TableRow key={o.offer} data-testid="insight-offer-row">
                          <TableCell>{o.offer}</TableCell>
                          <NumCell>{formatNumber(o.sent)}</NumCell>
                          <NumCell>{formatNumber(o.leads)}</NumCell>
                          <NumCell>{formatNumber(o.sales)}</NumCell>
                          <NumCell>
                            <Explained {...explainLeadToSale(o)}>{percent(o.leadToSale)}</Explained>
                          </NumCell>
                          <NumCell>
                            <Explained {...explainCost(o)}>{eur(o.costMicro)}</Explained>
                          </NumCell>
                          <NumCell>
                            <Explained {...explainRevenue(o)}>{eur(o.revenueMicro)}</Explained>
                          </NumCell>
                          <NumCell bad={o.roi !== null && o.roi < 0}>
                            <Explained {...explainRoi(o)}>{percent(o.roi)}</Explained>
                          </NumCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </details>
              ))}
            </div>
          </Card>

          <Card className="p-5" data-testid="insight-efficiency">
            <h2 className="text-sm font-semibold text-ink">
              <Explained formula={FORMULAS.smsPerSale}>SMS per sale</Explained>
            </h2>
            <p className="text-xs text-muted">
              The offers that need the fewest SMS to get one sale. Recalculated every time the page
              loads, so it follows the latest results.
            </p>
            {efficiency.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No offer has a sale in this period.</p>
            ) : (
              <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {efficiency.map((e, index) => (
                  <li
                    key={e.offer}
                    className="flex items-center gap-3 rounded-md border border-rule px-3 py-2"
                    data-testid="efficiency-item"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 font-mono text-xs text-muted">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.offer}</span>
                    <span className="font-mono text-sm font-medium tabular-nums text-ink">
                      <Explained {...explainSmsPerSale(e)}>{formatNumber(e.smsPerSale)}</Explained>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

function NumCell({ children, bad = false }: { children: React.ReactNode; bad?: boolean }) {
  return (
    <TableCell className={cn("text-right font-mono tabular-nums", bad && "text-signal")}>
      {children}
    </TableCell>
  );
}

/**
 * A ranked list of horizontal bars. Bars are sized against the largest absolute value; a
 * negative value (a loss) is drawn in the warning colour.
 */
function BarList({
  items,
  className,
  ranked = false,
  colors,
}: {
  items: readonly BarItem[];
  className?: string;
  ranked?: boolean;
  colors?: readonly string[];
}) {
  const max = Math.max(0, ...items.map((i) => Math.abs(i.value)));
  if (items.length === 0) {
    return <p className={cn("text-sm text-muted", className)}>Nothing to show in this period.</p>;
  }
  return (
    <ul className={cn("space-y-2.5", className)}>
      {items.map((item, index) => (
        <li key={item.label} data-testid="bar-item">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">
              {ranked ? (
                <span className="mr-2 font-mono text-xs text-muted">{index + 1}.</span>
              ) : null}
              {item.label}
            </span>
            <span className="font-mono tabular-nums text-ink">
              <Explained
                formula={item.explanation?.formula}
                working={item.explanation?.working}
                note={item.explanation?.note}
              >
                {item.display}
              </Explained>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-neutral-100">
            <div
              className={cn(
                "h-1.5 rounded-full",
                item.value < 0 ? "bg-signal" : (colors?.[index] ?? "bg-[#2a78d6]"),
              )}
              style={{ width: `${max > 0 ? Math.max(2, (Math.abs(item.value) / max) * 100) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
