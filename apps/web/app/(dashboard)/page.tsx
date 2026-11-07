import {
  cpsOverTime,
  cumulativeByCountry,
  foldSeries,
  insightCards,
  SEND_BUCKETS,
  type SeriesPoint,
} from "@sendex/core";
import {
  apiUsage,
  assetPerformance,
  contactsUploadedByMonth,
  conversionsByMonth,
  costPerSaleByMonth,
  countryBreakdown,
  type DashboardFilter,
  dashboardKpis,
  db,
  getBalanceMicro,
  roiRows,
  segmentsCard,
  sendCountDistribution,
  sentByPeriod,
  topLists,
  underSentContacts,
} from "@sendex/db";
import { Button, PageHeader } from "@sendex/ui";
import { Upload } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { NewCampaignModal } from "../../components/campaigns/new-campaign-modal";
import { ApiUsageTab } from "../../components/dashboard/api-usage-tab";
import { AssetsTab } from "../../components/dashboard/assets-tab";
import { ContactsTab } from "../../components/dashboard/contacts-tab";
import { CountriesTab } from "../../components/dashboard/countries-tab";
import { DashboardTabs } from "../../components/dashboard/dashboard-tabs";
import { GettingStarted } from "../../components/dashboard/getting-started";
import { OverviewTab } from "../../components/dashboard/overview-tab";
import { RoiTab } from "../../components/dashboard/roi-tab";
import {
  type AssetTab,
  type DashboardQuery,
  dashboardWindow,
  describeWindow,
  parseDashboardQuery,
} from "../../lib/dashboard-params";
import type { SearchParams } from "../../lib/lists-params";
import { workerPublicUrl } from "../../lib/worker-public-url";
import { RequireOrg } from "./require-org";

export const dynamic = "force-dynamic";

const LISTS_PAGE_SIZE = 10;
const ASSET_KIND: Record<AssetTab, "text" | "offer" | "sid"> = {
  texts: "text",
  offers: "offer",
  sids: "sid",
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * The SMS Dashboard (D4-05): Getting Started, Overview, ROI, Countries, Contacts, Assets and
 * API Usage under one tab strip, with the date range and countries filters in the URL. Only
 * the active tab's read models are loaded.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseDashboardQuery(await searchParams);
  const now = new Date();
  const filter: DashboardFilter = { ...dashboardWindow(query, now), countries: query.countries };
  const apiDocsUrl = workerPublicUrl() ? `${workerPublicUrl()}/api/docs` : null;
  return (
    <RequireOrg>
      {async (ctx) => {
        const org = ctx.organisationId;
        const body = await renderTab(org, query, filter, now, apiDocsUrl);
        return (
          <section className="space-y-5">
            <PageHeader
              breadcrumb={[{ label: "SMS" }, { label: "Dashboard" }]}
              title="SMS Dashboard"
              actions={
                <>
                  <Button variant="outline" asChild>
                    <Link href="/lists/upload">
                      <Upload className="h-4 w-4" aria-hidden="true" /> Upload Contacts
                    </Link>
                  </Button>
                  <NewCampaignModal />
                </>
              }
            />
            <DashboardTabs query={query} />
            <div role="tabpanel">{body}</div>
            <p className="text-xs text-muted">
              Organisation <span className="font-mono">{org}</span> · your role is {ctx.role}
            </p>
          </section>
        );
      }}
    </RequireOrg>
  );
}

function series(points: SeriesPoint[]) {
  return foldSeries(points, 8);
}

async function renderTab(
  org: string,
  query: DashboardQuery,
  filter: DashboardFilter,
  now: Date,
  apiDocsUrl: string | null,
): Promise<ReactNode> {
  const d = db();
  switch (query.tab) {
    case "getting-started": {
      const [kpis, balanceMicro] = await Promise.all([
        dashboardKpis(d, org, filter),
        getBalanceMicro(d, org),
      ]);
      return (
        <GettingStarted
          kpis={{ ...kpis, spendMicro: Number(kpis.spendMicro) }}
          balanceMicro={Number(balanceMicro)}
          apiDocsUrl={apiDocsUrl}
          docsUrl={process.env.NEXT_PUBLIC_DOCS_URL ?? null}
          supportUrl={process.env.NEXT_PUBLIC_SUPPORT_URL ?? null}
        />
      );
    }
    case "overview": {
      const [kpis, contacts, byMonth, byWeek] = await Promise.all([
        dashboardKpis(d, org, filter),
        contactsUploadedByMonth(d, org, filter),
        sentByPeriod(d, org, filter, "month"),
        sentByPeriod(d, org, filter, "week"),
      ]);
      return (
        <OverviewTab
          kpis={{
            ...kpis,
            spendMicro: Number(kpis.spendMicro),
            blendedCpsMicro: kpis.blendedCpsMicro === null ? null : Number(kpis.blendedCpsMicro),
          }}
          contactsByMonth={series(contacts)}
          sentByMonth={series(byMonth)}
          sentByWeek={series(byWeek)}
        />
      );
    }
    case "roi": {
      const [rows, monthly] = await Promise.all([
        roiRows(d, org, filter),
        costPerSaleByMonth(d, org),
      ]);
      return (
        <RoiTab
          rows={rows.map((r) => ({ ...r, cost: r.cost.toString(), revenue: r.revenue.toString() }))}
          cps={cpsOverTime(monthly).map((p) => ({
            month: p.month,
            monthlyCpsMicro: p.monthlyCpsMicro === null ? null : Number(p.monthlyCpsMicro),
            cumulativeCpsMicro: p.cumulativeCpsMicro === null ? null : Number(p.cumulativeCpsMicro),
          }))}
          windowLabel={describeWindow(query, now)}
        />
      );
    }
    case "countries": {
      const [rows, conversions] = await Promise.all([
        countryBreakdown(d, org, filter),
        conversionsByMonth(d, org, filter),
      ]);
      const accumulate = (points: SeriesPoint[]) => ({
        series: [...new Set(points.map((p) => p.key))].sort(),
        rows: cumulativeByCountry(points),
        total: points.reduce((t, p) => t + p.value, 0),
      });
      return (
        <CountriesTab
          rows={rows.map((r) => ({
            ...r,
            costMicro: Number(r.costMicro),
            lastSentAt: iso(r.lastSentAt),
          }))}
          signups={accumulate(conversions.signups)}
          buyers={accumulate(conversions.buyers)}
          insights={(() => {
            const cards = insightCards(rows);
            return {
              opportunity: cards.opportunity,
              economics: cards.economics.map((e) => ({
                country: e.country,
                cpsMicro: Number(e.cpsMicro),
              })),
            };
          })()}
          now={now.toISOString()}
        />
      );
    }
    case "contacts": {
      const [lists, segments, pool, buckets, under] = await Promise.all([
        topLists(d, org, {
          countries: query.countries,
          page: query.listsPage,
          pageSize: LISTS_PAGE_SIZE,
        }),
        segmentsCard(d, org),
        countryBreakdown(d, org, filter),
        sendCountDistribution(d, org, filter),
        underSentContacts(d, org, { threshold: query.threshold, countries: query.countries }),
      ]);
      const folded = foldSeries(
        buckets.map((b) => ({ period: b.bucket, key: b.country, value: b.contacts })),
        8,
      );
      // Keep the bucket order of the spec, every bucket present.
      const bucketRows = SEND_BUCKETS.map((bucket) => {
        const found = folded.rows.find((r) => r.period === bucket);
        if (found) return found;
        const row: Record<string, number | string> = { period: bucket };
        for (const s of folded.series) row[s] = 0;
        return row as (typeof folded.rows)[number];
      });
      const ctr: Record<string, number> = {};
      for (const bucket of SEND_BUCKETS) {
        const sent = buckets.filter((b) => b.bucket === bucket).reduce((t, b) => t + b.sent, 0);
        const clicks = buckets.filter((b) => b.bucket === bucket).reduce((t, b) => t + b.clicks, 0);
        ctr[bucket] = sent > 0 ? clicks / sent : 0;
      }
      return (
        <ContactsTab
          query={query}
          lists={{ rows: lists.rows, total: lists.total, pageSize: LISTS_PAGE_SIZE }}
          segments={segments.map((s) => ({ ...s, lastUsedAt: iso(s.lastUsedAt) }))}
          pool={pool
            .filter((r) => r.contacts > 0 || r.sent > 0)
            .map((r) => ({ country: r.country, contacts: r.contacts, sent: r.sent }))}
          buckets={{ series: folded.series, rows: buckets.length === 0 ? [] : bucketRows, ctr }}
          underSent={{
            rows: under,
            good: under.reduce((t, r) => t + r.good, 0),
            under: under.reduce((t, r) => t + r.under, 0),
          }}
        />
      );
    }
    case "assets": {
      const result = await assetPerformance(d, org, {
        kind: ASSET_KIND[query.asset],
        search: query.q,
        ...filter,
      });
      return (
        <AssetsTab
          query={query}
          rows={result.rows.map((r) => ({
            ...r,
            spendMicro: Number(r.spendMicro),
            lastSentAt: iso(r.lastSentAt),
          }))}
          total={result.total}
          now={now.toISOString()}
        />
      );
    }
    case "api": {
      const usage = await apiUsage(d, org, filter);
      const folded = series(usage.perCountryByMonth);
      return (
        <ApiUsageTab
          kpis={{ ...usage.kpis, spendMicro: Number(usage.kpis.spendMicro) }}
          perCountry={{ series: folded.series, rows: folded.rows }}
          countries={usage.countries.map((c) => ({
            ...c,
            spendMicro: Number(c.spendMicro),
            lastSentAt: iso(c.lastSentAt),
          }))}
          log={usage.log.map((m) => ({
            ...m,
            costMicro: Number(m.costMicro),
            sentAt: m.sentAt.toISOString(),
          }))}
          apiDocsUrl={apiDocsUrl}
          now={now.toISOString()}
        />
      );
    }
  }
}
