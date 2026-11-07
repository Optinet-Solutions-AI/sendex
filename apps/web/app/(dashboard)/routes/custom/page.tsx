import { can } from "@sendex/core";
import {
  customRouteCountries,
  customRouteSendingStats,
  customRouteSmsLog,
  db,
  getRoutingConfig,
  listConnectionEvents,
  listCustomRoutes,
  platformRouteCatalogue,
} from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { CustomRoutes, type CustomRouteView } from "../../../../components/routes/custom-routes";
import { CustomStats, type StatsView } from "../../../../components/routes/custom-stats";
import {
  RoutingConfig,
  type RoutingConfigView,
} from "../../../../components/routes/routing-config";
import type { SearchParams } from "../../../../lib/lists-params";
import { parseRoutesQuery, routesWindow } from "../../../../lib/routes-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

/** Routes › Custom Routes (D4-06): the tenant's own carriers, the routing strategy and their stats. */
export default async function CustomRoutesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseRoutesQuery(await searchParams, "30d");
  return (
    <RequireOrg action="route.view">
      {async (ctx) => {
        const org = ctx.organisationId;
        const d = db();
        const canManage = can(ctx.role, "route.manage");
        const [routes, config] = await Promise.all([
          listCustomRoutes(d, org),
          getRoutingConfig(d, org),
        ]);
        const view: CustomRouteView[] = routes.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          host: r.host,
          active: r.active,
          config: r.config,
          prices: r.prices.map((p) => ({ country: p.country, priceMicro: Number(p.priceMicro) })),
          createdAt: r.createdAt.toISOString(),
        }));

        let routing: RoutingConfigView | null = null;
        let stats: StatsView | null = null;
        if (query.tab === "routing") {
          const [countries, catalogue] = await Promise.all([
            customRouteCountries(d, org),
            platformRouteCatalogue(d),
          ]);
          const platformNames = new Map(catalogue.map((c) => [c.routeId, c.name]));
          routing = {
            strategy: config.strategy,
            exceptions: config.exceptions,
            countries,
            routes: [
              ...routes.map((r) => ({ id: r.id, name: r.name, platform: false })),
              ...[...platformNames.entries()].map(([id, name]) => ({ id, name, platform: true })),
            ],
          };
        } else if (query.tab === "stats") {
          const started = Date.now();
          const window = routesWindow(query);
          const selected = query.routes[0] ?? "";
          const [sending, log, events] = await Promise.all([
            customRouteSendingStats(d, org, { ...window, byCountry: query.showLow }),
            customRouteSmsLog(d, org, { ...window, routeId: selected || undefined }),
            selected ? listConnectionEvents(d, org, selected) : Promise.resolve([]),
          ]);
          stats = {
            queryMs: Date.now() - started,
            sending,
            byCountry: query.showLow,
            log: log.map((m) => ({ ...m, at: m.at.toISOString(), costMicro: Number(m.costMicro) })),
            events: events.map((e) => ({ ...e, at: e.at.toISOString() })),
            routes: routes.map((r) => ({ id: r.id, name: r.name })),
            selectedRoute: selected,
          };
        }
        return (
          <section className="space-y-5">
            <PageHeader
              breadcrumb={[{ label: "Routes" }, { label: "Custom Routes" }]}
              title="Custom Routes"
            />
            <CustomRoutes
              query={query}
              routes={view}
              canManage={canManage}
              feeMicro={Number(config.feeMicro)}
              panels={{
                routing: routing ? <RoutingConfig config={routing} canManage={canManage} /> : null,
                stats: stats ? <CustomStats query={query} stats={stats} /> : null,
              }}
            />
          </section>
        );
      }}
    </RequireOrg>
  );
}
