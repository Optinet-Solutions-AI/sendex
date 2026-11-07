import { unsubscribeUrls } from "@sendex/core";
import {
  db,
  findOrganisationByKey,
  listSuppressionImports,
  listSuppressions,
  suppressionStats,
} from "@sendex/db";
import { KpiStrip, PageHeader } from "@sendex/ui";
import { UnsubscribeActions } from "../../../components/unsubscribes/actions";
import { ApiTab } from "../../../components/unsubscribes/api-tab";
import { ImportsTab } from "../../../components/unsubscribes/imports-tab";
import { NumbersTab } from "../../../components/unsubscribes/numbers-tab";
import { isUnsubscribeTab } from "../../../components/unsubscribes/tab-names";
import { UnsubscribeTabs } from "../../../components/unsubscribes/tabs";
import { AuthError, requireAction } from "../../../lib/auth";
import { formatNumber } from "../../../lib/format";
import { workerPublicUrl } from "../../../lib/worker-public-url";
import { AuthErrorView } from "../require-org";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const WORKER_PLACEHOLDER = "https://<worker-address>";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Contacts › Unsubscribe of the spec: Resubscribe, + Add number and Upload unsubscribes on
 * the right; two KPI cells; the Numbers, Imported lists and Unsubscribe API pill tabs.
 * Suppression is account-wide and immediate: the send loop skips every number here.
 */
export default async function UnsubscribesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("list.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const query = await searchParams;
  const tabParam = first(query.tab);
  const tab = isUnsubscribeTab(tabParam) ? tabParam : "numbers";
  const pageRaw = Number.parseInt(first(query.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const search = first(query.q).trim();
  const database = db();
  const [stats, numbers, imports, organisation] = await Promise.all([
    suppressionStats(database, ctx.organisationId),
    listSuppressions(database, ctx.organisationId, {
      page,
      pageSize: PAGE_SIZE,
      ...(search ? { search } : {}),
    }),
    listSuppressionImports(database, ctx.organisationId),
    findOrganisationByKey(database, ctx.organisationId),
  ]);
  const urls = unsubscribeUrls(
    workerPublicUrl() ?? WORKER_PLACEHOLDER,
    organisation?.slug ?? ctx.organisationId,
  );
  const canEdit = ctx.role !== "viewer";

  return (
    <section className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Contacts" }, { label: "Unsubscribe" }]}
        title="Unsubscribe"
        actions={canEdit ? <UnsubscribeActions /> : null}
      />
      <KpiStrip
        label="Unsubscribe figures"
        items={[
          {
            label: "Unsubscribed numbers",
            value: formatNumber(stats.numbers),
            hint: "Never contacted again on this account",
            testId: "unsub-count",
          },
          {
            label: "Imported lists",
            value: formatNumber(stats.imports),
            hint: "Suppression files you uploaded",
            testId: "unsub-imports",
          },
        ]}
      />
      <UnsubscribeTabs active={tab} />
      <div role="tabpanel">
        {tab === "numbers" ? (
          <NumbersTab
            rows={numbers.rows.map((r) => ({
              id: r.id,
              e164: r.e164,
              country: r.country,
              source: r.source,
              createdAt: r.createdAt.toISOString(),
            }))}
            total={numbers.total}
            page={page}
            pageSize={PAGE_SIZE}
            search={search}
          />
        ) : tab === "imports" ? (
          <ImportsTab
            rows={imports.map((j) => ({
              id: j.id,
              fileName: j.fileName,
              count: j.count,
              rejected: j.rejected,
              createdAt: j.createdAt.toISOString(),
            }))}
          />
        ) : (
          <ApiTab byDynamic={urls.byDynamic} byNumber={urls.byNumber} />
        )}
      </div>
    </section>
  );
}
