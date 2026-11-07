import { can } from "@sendex/core";
import { db, listSmsTests, testCostReport } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { Testing } from "../../../../components/routes/testing";
import type { SearchParams } from "../../../../lib/lists-params";
import { parseRoutesQuery } from "../../../../lib/routes-params";
import { RequireOrg } from "../../require-org";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/** Routes › Testing (D4-06): SMS Tests, Send Single and Test SMS. */
export default async function TestingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseRoutesQuery(await searchParams);
  return (
    <RequireOrg action="route.view">
      {async (ctx) => {
        const [listing, costReport] = await Promise.all([
          listSmsTests(db(), ctx.organisationId, {
            country: query.countries[0],
            showRemoved: query.showRemoved,
            singlesOnly: query.singlesOnly,
            page: query.page,
            pageSize: PAGE_SIZE,
          }),
          testCostReport(db(), ctx.organisationId),
        ]);
        return (
          <section className="space-y-5">
            <PageHeader breadcrumb={[{ label: "SMS" }, { label: "Tests" }]} title="SMS Tests" />
            <Testing
              query={query}
              rows={listing.rows.map((r) => ({
                id: r.id,
                type: r.type,
                country: r.country,
                routeNames: r.routeNames,
                senderModes: r.senderModes,
                customSender: r.customSender,
                textPresets: r.textPresets,
                recipient: r.recipient,
                scheduled: r.scheduled,
                testsRan: r.testsRan,
                successCount: r.successCount,
                costMicro: Number(r.costMicro),
                queueStatus: r.queueStatus,
                createdAt: r.createdAt.toISOString(),
                lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
                removedAt: r.removedAt ? r.removedAt.toISOString() : null,
              }))}
              total={listing.total}
              pageSize={PAGE_SIZE}
              costReport={costReport.map((m) => ({ ...m, costMicro: Number(m.costMicro) }))}
              canSend={can(ctx.role, "test.send")}
            />
          </section>
        );
      }}
    </RequireOrg>
  );
}
