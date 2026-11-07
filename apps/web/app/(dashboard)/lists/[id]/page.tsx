import { can, countryName, flagEmoji } from "@sendex/core";
import {
  type AnalyticsDimension,
  db,
  getList,
  listAnalytics,
  listCampaignsForList,
  listKpis,
  listListImports,
  listLookupBreakdown,
  listLookupCounts,
  listMembersPage,
  type MemberStatusFilter,
  maskRecipient,
} from "@sendex/db";
import { KpiStrip, PageHeader } from "@sendex/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsTab } from "../../../../components/lists/analytics-tab";
import { CampaignsTab } from "../../../../components/lists/campaigns-tab";
import { ContactsTab } from "../../../../components/lists/contacts-tab";
import { DataFilesTab } from "../../../../components/lists/data-files-tab";
import { ListActions } from "../../../../components/lists/list-actions";
import { ListTabs } from "../../../../components/lists/list-tabs";
import { LookupTab } from "../../../../components/lists/lookup-tab";
import { isListTab } from "../../../../components/lists/tabs";
import { AuthError, requireAction } from "../../../../lib/auth";
import { formatNumber } from "../../../../lib/format";
import { AuthErrorView } from "../../require-org";

export const dynamic = "force-dynamic";

const CONTACTS_PAGE_SIZE = 25;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * List details of the spec: breadcrumb and back arrow, Refresh and + New Campaign, the KPI
 * tiles on every tab, and the Contacts, Analytics, Data Files, Campaigns and Lookup tabs.
 * Numbers are masked in the Contacts tab and never written to logs.
 */
export default async function ListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("list.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const query = await searchParams;
  const tabParam = first(query.tab);
  const tab = isListTab(tabParam) ? tabParam : "contacts";
  const database = db();
  const [list, kpis] = await Promise.all([
    getList(database, ctx.organisationId, id),
    listKpis(database, ctx.organisationId, id),
  ]);
  if (!list) notFound();

  let panel: React.ReactNode = null;
  if (tab === "contacts") {
    const pageRaw = Number.parseInt(first(query.page), 10);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
    const search = first(query.q).trim();
    const statusRaw = first(query.status);
    const status: MemberStatusFilter | undefined =
      statusRaw === "good" || statusRaw === "bad" || statusRaw === "sent" ? statusRaw : undefined;
    const members = await listMembersPage(database, ctx.organisationId, id, {
      page,
      pageSize: CONTACTS_PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
    });
    panel = (
      <ContactsTab
        listId={id}
        rows={members.rows.map((m) => ({
          id: m.id,
          number: maskRecipient(m.e164),
          country: m.country,
          bad: m.bad,
          badReason: m.badReason,
          sent: m.sentAt !== null,
          createdAt: m.createdAt.toISOString(),
        }))}
        total={members.total}
        page={page}
        pageSize={CONTACTS_PAGE_SIZE}
        search={search}
        status={status ?? ""}
      />
    );
  } else if (tab === "analytics") {
    const dims = first(query.dims)
      .split(",")
      .filter((d): d is AnalyticsDimension => d === "country" || d === "device");
    const started = Date.now();
    const rows = await listAnalytics(database, ctx.organisationId, id, dims);
    panel = (
      <AnalyticsTab
        listId={id}
        dimensions={dims}
        queryMs={Date.now() - started}
        rows={rows.map((r) => ({
          ...r,
          costMicro: Number(r.costMicro),
          revenueMicro: Number(r.revenueMicro),
        }))}
      />
    );
  } else if (tab === "files") {
    const jobs = await listListImports(database, ctx.organisationId, {
      listId: id,
      page: 1,
      pageSize: 20,
    });
    panel = (
      <DataFilesTab
        list={{ id: list.id, name: list.name, country: list.country }}
        canUpload={can(ctx.role, "list.upload")}
        jobs={jobs.rows.map((r) => ({
          id: r.id,
          fileName: r.fileName,
          source: r.source,
          status: r.status,
          rowsInFile: r.rowsInFile,
          valid: r.valid,
          added: r.added,
          addedGood: r.addedGood,
          addedBad: r.addedBad,
          rejected: r.rejected,
          skipped: r.skipped,
          duplicates: r.duplicates,
          dedup: r.dedup,
          summary: r.summary,
          listId: r.listId,
          listName: r.listName,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    );
  } else if (tab === "campaigns") {
    const rows = await listCampaignsForList(database, ctx.organisationId, id);
    panel = (
      <CampaignsTab
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status as ListCampaignStatus,
          laps: r.laps,
          sent: r.sent,
          clicks: r.clicks,
          ctr: r.ctr,
          costMicro: Number(r.costMicro),
          firstLapAt: r.firstLapAt?.toISOString() ?? null,
          lastLapAt: r.lastLapAt?.toISOString() ?? null,
        }))}
      />
    );
  } else {
    const [breakdown, lookups] = await Promise.all([
      listLookupBreakdown(database, ctx.organisationId, id),
      listLookupCounts(database, ctx.organisationId, id),
    ]);
    const byCountry = new Map(lookups.map((l) => [l.country, l]));
    const rows = breakdown.map((r) => {
      const l = byCountry.get(r.country);
      return l
        ? {
            ...r,
            hlr: l.hlr,
            mnp: l.mnp,
            localOnly: l.localOnly,
            checking: l.checking,
            cached: l.cached,
            unresolved: r.total - r.bad - l.hlr - l.mnp - l.localOnly - l.checking,
          }
        : r;
    });
    panel = <LookupTab rows={rows} listId={id} canVerify={can(ctx.role, "list.upload")} />;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Contacts" },
          { label: "Lists", href: "/lists" },
          { label: list.name },
        ]}
        title={
          <span className="inline-flex items-center gap-2">
            <Link href="/lists" aria-label="Back to lists" className="text-muted hover:text-ink">
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            {list.name}
          </span>
        }
        meta={
          <>
            {flagEmoji(list.country)} {countryName(list.country)}
            {list.archivedAt ? " · Archived" : ""}
          </>
        }
        actions={
          <ListActions
            listId={list.id}
            listName={list.name}
            canFlush={can(ctx.role, "list.flush")}
            canCreateCampaign={can(ctx.role, "campaign.create") && list.archivedAt === null}
          />
        }
      />

      <KpiStrip
        label="List figures"
        items={[
          { label: "Total numbers", value: formatNumber(kpis.total), testId: "count-members" },
          { label: "Good", value: formatNumber(kpis.good), testId: "count-good", tone: "good" },
          {
            label: "Bad",
            value: formatNumber(kpis.bad),
            testId: "count-bad",
            tone: kpis.bad > 0 ? "bad" : "default",
          },
          { label: "Cached", value: formatNumber(kpis.cached), testId: "count-cached" },
          { label: "Sent", value: formatNumber(kpis.sent), testId: "count-sent" },
          { label: "Clicks", value: formatNumber(kpis.clicks), testId: "count-clicks" },
          { label: "CTR", value: `${(kpis.ctr * 100).toFixed(0)}%`, testId: "count-ctr" },
        ]}
      />

      <ListTabs active={tab} />
      <div role="tabpanel">{panel}</div>
    </section>
  );
}

type ListCampaignStatus = "draft" | "scheduled" | "sending" | "paused" | "stopped" | "completed";
