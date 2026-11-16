import { leadToSale, sortSalesResults } from "@sendex/core";
import { db, salesResults } from "@sendex/db";
import { SalesResults } from "../../../../components/kpi/sales-results";
import { insightWindow, parseSalesResultsQuery } from "../../../../lib/kpi-params";
import type { SearchParams } from "../../../../lib/lists-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

/** Sales Results (D5-05): registrations and first deposits per day, offer, route and list. */
export default async function SalesResultsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const now = new Date();
  const query = parseSalesResultsQuery(await searchParams, now);
  return (
    <RequireOrg action="campaign.view">
      {async (ctx) => {
        const rows = await salesResults(db(), ctx.organisationId, insightWindow(query));
        const leads = rows.reduce((n, r) => n + r.leads, 0);
        const sales = rows.reduce((n, r) => n + r.sales, 0);
        const revenue = rows.reduce((n, r) => n + r.revenueMicro, 0n);
        return (
          <SalesResults
            query={query}
            thisYear={now.getUTCFullYear()}
            rows={sortSalesResults(rows, query.sort).map((r) => ({
              ...r,
              revenueMicro: r.revenueMicro.toString(),
            }))}
            totals={{
              leads,
              sales,
              leadToSale: leadToSale({ leads, sales }),
              revenueMicro: revenue.toString(),
            }}
          />
        );
      }}
    </RequireOrg>
  );
}
