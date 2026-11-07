import { mobileNetworks } from "@sendex/core";
import { db, networkStats, sentRouteOptions } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { MobileNetworks } from "../../../../components/routes/mobile-networks";
import type { SearchParams } from "../../../../lib/lists-params";
import { parseRoutesQuery, routesWindow } from "../../../../lib/routes-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

/** Routes › Mobile Networks (D4-06): how each operator performs against the others in its country. */
export default async function MobileNetworksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseRoutesQuery(await searchParams, "30d");
  return (
    <RequireOrg action="route.view">
      {async (ctx) => {
        const [stats, routes] = await Promise.all([
          networkStats(db(), ctx.organisationId, {
            ...routesWindow(query),
            countries: query.countries,
            routeIds: query.routes,
            search: query.q,
          }),
          sentRouteOptions(db(), ctx.organisationId),
        ]);
        const view = mobileNetworks(stats, { showLowVolume: query.showLow });
        return (
          <section className="space-y-5">
            <PageHeader
              breadcrumb={[{ label: "SMS" }, { label: "Routes" }, { label: "Mobile Networks" }]}
              title="Mobile Networks"
              subtitle="How each mobile operator performs against the others in its own country."
            />
            <MobileNetworks query={query} view={view} routes={routes} />
          </section>
        );
      }}
    </RequireOrg>
  );
}
