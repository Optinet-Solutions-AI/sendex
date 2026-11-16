import {
  countryName,
  efficiencySnapshot,
  insightTotals,
  leadToSale,
  roi,
  rollUp,
  topOffersByCountry,
} from "@sendex/core";
import { db, kpiByOfferCountry } from "@sendex/db";
import { type BarItem, Insight } from "../../../../components/kpi/insight";
import { insightWindow, parseInsightQuery } from "../../../../lib/kpi-params";
import type { SearchParams } from "../../../../lib/lists-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

const TOP_BARS = 7;

const percentText = (value: number) => `${(value * 100).toFixed(1)}%`;
const micro = (value: bigint | null) => (value === null ? null : value.toString());

/** Performance Insight (D5-04): the period's totals, per-sale figures and where sales come from. */
export default async function InsightPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const now = new Date();
  const query = parseInsightQuery(await searchParams, now);
  return (
    <RequireOrg action="campaign.view">
      {async (ctx) => {
        const rows = await kpiByOfferCountry(db(), ctx.organisationId, insightWindow(query));
        const totals = insightTotals(rows);
        const offers = rollUp(rows, "offer");
        const byCountry = rollUp(rows, "country");

        const roiBars = (items: typeof offers, label: (key: string) => string): BarItem[] =>
          items
            .flatMap((item) => {
              const value = roi(item);
              return value === null
                ? []
                : [{ label: label(item.label), value, display: percentText(value) }];
            })
            .sort((a, b) => b.value - a.value)
            .slice(0, TOP_BARS);

        return (
          <Insight
            query={query}
            thisYear={now.getUTCFullYear()}
            totals={{
              sent: totals.sent,
              leads: totals.leads,
              sales: totals.sales,
              costMicro: totals.costMicro.toString(),
              revenueMicro: totals.revenueMicro.toString(),
              profitMicro: totals.profitMicro.toString(),
              costPerSaleMicro: micro(totals.costPerSaleMicro),
              revenuePerSaleMicro: micro(totals.revenuePerSaleMicro),
              profitPerSaleMicro: micro(totals.profitPerSaleMicro),
              smsPerSale: totals.smsPerSale,
            }}
            offersByRoi={roiBars(offers, (name) => name)}
            roiByCountry={roiBars(byCountry, countryName)}
            salesByCountry={byCountry
              .filter((c) => c.sales > 0)
              .map((c) => ({
                label: countryName(c.label),
                value: c.sales,
                display: String(c.sales),
              }))}
            countries={topOffersByCountry(rows, query.sort).map((c) => ({
              country: c.country,
              sales: c.sales,
              offers: c.offers.map((o) => ({
                offer: o.offer,
                sent: o.sent,
                leads: o.leads,
                sales: o.sales,
                leadToSale: leadToSale(o),
                costMicro: o.costMicro.toString(),
                revenueMicro: o.revenueMicro.toString(),
                roi: roi(o),
              })),
            }))}
            efficiency={efficiencySnapshot(rows)}
          />
        );
      }}
    </RequireOrg>
  );
}
