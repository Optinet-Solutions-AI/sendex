import { db, platformDeliveryReport, platformRouteCatalogue } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { PlatformRoutes } from "../../../../components/routes/platform-routes";
import type { SearchParams } from "../../../../lib/lists-params";
import { parseRoutesQuery, routesWindow } from "../../../../lib/routes-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

/** Routes › Platform Routes (D4-06): what the organisation can send through and how it delivered. */
export default async function PlatformRoutesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseRoutesQuery(await searchParams);
  return (
    <RequireOrg action="route.view">
      {async (ctx) => {
        const [catalogue, report] = await Promise.all([
          platformRouteCatalogue(db()),
          platformDeliveryReport(db(), ctx.organisationId, {
            ...routesWindow(query),
            countries: query.countries,
            search: query.q,
          }),
        ]);
        return (
          <section className="space-y-5">
            <PageHeader
              breadcrumb={[{ label: "SMS" }, { label: "Routes" }, { label: "Platform Routes" }]}
              title="Platform Routes"
              subtitle="Routes available to your account and how they have delivered."
            />
            <PlatformRoutes
              query={query}
              catalogue={catalogue.map((r) => ({ ...r, priceMicro: Number(r.priceMicro) }))}
              report={report.map((r) => ({
                ...r,
                priceMicro: r.priceMicro === null ? null : Number(r.priceMicro),
                costMicro: Number(r.costMicro),
              }))}
            />
          </section>
        );
      }}
    </RequireOrg>
  );
}
