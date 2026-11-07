import { can, verificationKpis } from "@sendex/core";
import {
  db,
  listEnrichmentRules,
  lookupCounts,
  lookupCoverage,
  networkBreakdown,
  verificationLog,
} from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { EnrichmentPage } from "../../../components/enrichment/enrichment-page";
import type { SearchParams } from "../../../lib/lists-params";
import { parseRoutesQuery, routesWindow } from "../../../lib/routes-params";
import { RequireOrg } from "../require-org";

export const dynamic = "force-dynamic";

/** Contacts › Enrichment (D4-07): Numbers Verification. */
export default async function EnrichmentRoutePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseRoutesQuery(await searchParams, "30d");
  return (
    <RequireOrg action="list.view">
      {async (ctx) => {
        const d = db();
        const [counts, rules, log, networks, coverage] = await Promise.all([
          lookupCounts(d, ctx.organisationId),
          listEnrichmentRules(d, ctx.organisationId),
          verificationLog(d, ctx.organisationId, {
            ...routesWindow(query),
            country: query.countries[0],
          }),
          networkBreakdown(d, ctx.organisationId),
          lookupCoverage(d),
        ]);
        return (
          <section className="space-y-5">
            <PageHeader
              breadcrumb={[{ label: "Contacts" }, { label: "Numbers Verification" }]}
              title="Numbers Verification"
            />
            <EnrichmentPage
              query={query}
              kpis={verificationKpis(counts)}
              rules={rules.map((r) => ({
                id: r.id,
                country: r.country,
                dailyLimit: r.dailyLimit,
                monthlyBudgetMicro: Number(r.monthlyBudgetMicro),
                onSchedule: r.onSchedule,
                afterUpload: r.afterUpload,
                asYouSend: r.asYouSend,
                includeArchived: r.includeArchived,
                active: r.active,
              }))}
              log={log.map((r) => ({
                day: r.day,
                country: r.country,
                total: r.total,
                good: r.good,
                bad: r.bad,
                noVerdict: r.noVerdict,
              }))}
              networks={networks}
              coverage={coverage.map((c) => ({ ...c, priceMicro: Number(c.priceMicro) }))}
              canManage={can(ctx.role, "list.upload")}
              lookupConfigured={
                process.env.LOOKUP_PROVIDER === "fake" || Boolean(process.env.LOOKUP_PROVIDER)
              }
            />
          </section>
        );
      }}
    </RequireOrg>
  );
}
