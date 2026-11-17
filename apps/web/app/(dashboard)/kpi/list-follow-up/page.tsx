import {
  can,
  groupListFollowUp,
  type KpiCounters,
  type ListFollowUpRow,
  leadToSale,
  roi,
} from "@sendex/core";
import { db, kpiFilterOptions, listFollowUp } from "@sendex/db";
import {
  type FollowUpListView,
  type FollowUpNumbers,
  ListFollowUp,
} from "../../../../components/kpi/list-follow-up";
import { followUpFilter, parseListFollowUpQuery } from "../../../../lib/kpi-params";
import type { SearchParams } from "../../../../lib/lists-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

function numbers(c: KpiCounters, lastSentAt: Date | null): FollowUpNumbers {
  return {
    sent: c.sent,
    leads: c.leads,
    sales: c.sales,
    costMicro: c.costMicro.toString(),
    revenueMicro: c.revenueMicro.toString(),
    leadToSale: leadToSale(c),
    roi: roi(c),
    lastSentAt: lastSentAt?.toISOString() ?? null,
  };
}

function listView(l: ListFollowUpRow): FollowUpListView {
  return {
    ...numbers(l, l.lastSentAt),
    listId: l.listId,
    name: l.name,
    country: l.country,
    provider: l.provider,
    numbersCount: l.numbersCount,
    createdAt: l.createdAt.toISOString(),
  };
}

/** List Follow-Up (D5-03): lists used and untouched per country, with what they produced. */
export default async function ListFollowUpPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseListFollowUpQuery(await searchParams);
  return (
    <RequireOrg action="campaign.view" preview>
      {async (ctx) => {
        const database = db();
        const [rows, options] = await Promise.all([
          listFollowUp(database, ctx.organisationId, followUpFilter(query)),
          kpiFilterOptions(database, ctx.organisationId),
        ]);
        const grouped = groupListFollowUp(rows);
        return (
          <ListFollowUp
            query={query}
            routes={options.routes}
            offers={options.offers}
            countries={grouped.countries.map((c) => ({
              ...numbers(c, c.lastSentAt),
              country: c.country,
              totalLists: c.totalLists,
              lists: c.lists.map(listView),
            }))}
            untouched={grouped.untouched.map(listView)}
            canCreate={can(ctx.role, "campaign.create")}
          />
        );
      }}
    </RequireOrg>
  );
}
