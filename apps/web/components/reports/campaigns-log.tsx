"use client";

import {
  countryName,
  countryOptions,
  flagEmoji,
  formatCpc,
  formatLogDay,
  formatSpend,
  type LogKpis,
} from "@sendex/core";
import {
  Button,
  CountPill,
  CountryMultiSelect,
  cn,
  type DateRange,
  DateRangePicker,
  KpiStrip,
  PageHeader,
  PaginationBar,
  SegmentedControl,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from "@sendex/ui";
import { ArrowDown, Download, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  type CampaignsLogQuery,
  campaignsLogQueryString,
  LOG_PAGE_SIZE,
  type LogPeriod,
} from "../../lib/campaigns-log-params";
import { formatNumber } from "../../lib/format";

export interface LogRowView {
  day: string;
  campaignId: string | null;
  campaignName: string | null;
  country: string;
  listName: string | null;
  routeName: string;
  sent: number;
  /** Micro-EUR as a string (bigint does not cross the server boundary). */
  spendMicro: string;
  ctr: number;
  clicks: number;
  cpcMicro: string | null;
  leads: number;
  /** First deposits made that day. */
  sales: number;
  /** The part of `sales` whose SMS went out on an earlier day (D4-12). */
  lateSales: number;
}

export interface LogKpisView extends Omit<LogKpis, "spendMicro" | "cpcMicro"> {
  spendMicro: string;
  cpcMicro: string | null;
}

const PERIODS: ReadonlyArray<{ value: LogPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "custom", label: "Custom" },
];

const COUNTRIES = countryOptions.map((c) => ({ code: c.code, name: c.name, flag: c.flag }));

const Dash = () => <span className="text-muted">—</span>;

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/**
 * The Campaigns Log of the spec: period segment, countries, KPI strip and one row per day ×
 * campaign × country × list × route, with Export CSV and "Page 1 of 2".
 */
export function CampaignsLog({
  rows,
  total,
  kpis,
  query,
}: {
  rows: LogRowView[];
  total: number;
  kpis: LogKpisView;
  query: CampaignsLogQuery;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const navigate = (next: Partial<CampaignsLogQuery>) => {
    router.push(`/reports/campaigns-log${campaignsLogQueryString({ ...query, page: 1, ...next })}`);
  };
  const onPeriod = (period: LogPeriod) => {
    if (period === "custom" && !query.from && !query.to) {
      navigate({ period, from: "", to: "" });
      return;
    }
    navigate({ period });
  };
  const onRange = (range: DateRange) =>
    navigate({ period: "custom", from: range.from, to: range.to });
  const exportHref = `/reports/campaigns-log/export${campaignsLogQueryString({ ...query, page: 1 })}`;

  return (
    <section className="space-y-4" data-testid="campaigns-log">
      <PageHeader
        breadcrumb={[
          { label: "Campaigns", href: "/campaigns" },
          { label: "Reports" },
          { label: "Campaigns Log" },
        ]}
        title="Campaigns Log"
        subtitle="Daily sending broken down by campaign, country, list and route."
        actions={
          <Tooltip content="Export the filtered report as CSV">
            <Button variant="outline" asChild>
              <a href={exportHref} data-testid="export-csv">
                <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
              </a>
            </Button>
          </Tooltip>
        }
      />

      <div className="flex flex-wrap items-center gap-3" data-testid="log-filters">
        <SegmentedControl
          label="Period"
          value={query.period}
          options={PERIODS}
          onChange={onPeriod}
        />
        {query.period === "custom" ? (
          <DateRangePicker value={{ from: query.from, to: query.to }} onChange={onRange} />
        ) : null}
        <CountryMultiSelect
          countries={COUNTRIES}
          value={query.countries}
          onChange={(countries) => navigate({ countries })}
        />
        <div className="ml-auto flex items-center gap-2">
          <CountPill count={total} noun="row" testId="log-row-count" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => startRefresh(() => router.refresh())}
            aria-label="Refresh"
            data-testid="log-refresh"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden="true" />{" "}
            Refresh
          </Button>
        </div>
      </div>

      <KpiStrip
        label="Log totals"
        items={[
          { label: "Sent", value: formatNumber(kpis.sent), testId: "kpi-sent" },
          { label: "Clicks", value: formatNumber(kpis.clicks), testId: "kpi-clicks" },
          { label: "CTR", value: percent(kpis.ctr), testId: "kpi-ctr" },
          { label: "Spend", value: formatSpend(BigInt(kpis.spendMicro)), testId: "kpi-spend" },
          {
            label: "CPC",
            value: formatCpc(kpis.cpcMicro === null ? null : BigInt(kpis.cpcMicro)),
            testId: "kpi-cpc",
          },
          {
            label: "Leads / Sales",
            value: `${formatNumber(kpis.leads)} / ${formatNumber(kpis.sales)}`,
            testId: "kpi-leads-sales",
          },
          {
            label: "Late sales",
            value: formatNumber(kpis.lateSales),
            testId: "kpi-late-sales",
          },
        ]}
      />

      <Table data-testid="log-table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>
              <span className="inline-flex items-center gap-1">
                Date <ArrowDown className="h-3 w-3" aria-hidden="true" />
              </span>
            </TableHead>
            <TableHead>Campaign</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>List</TableHead>
            <TableHead>Route</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">CTR</TableHead>
            <TableHead className="text-right">Clicks</TableHead>
            <TableHead className="text-right">CPC</TableHead>
            <TableHead className="text-right">Leads</TableHead>
            <TableHead className="text-right">Sales</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={12} className="py-10 text-center text-muted">
                No sends in this period.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={`${row.day}:${row.campaignId ?? "api"}:${row.country}:${row.listName ?? ""}:${row.routeName}`}
                data-testid="log-row"
                data-day={row.day}
              >
                <TableCell className="tabular-nums text-muted">{formatLogDay(row.day)}</TableCell>
                <TableCell className="max-w-[16rem]">
                  {row.campaignId ? (
                    <Link
                      href={`/campaigns/${row.campaignId}`}
                      className="block truncate font-semibold text-ink hover:underline"
                      title={row.campaignName ?? row.campaignId}
                      data-testid="log-campaign"
                    >
                      {row.campaignName ?? row.campaignId}
                    </Link>
                  ) : (
                    <span className="text-muted">(API / no campaign)</span>
                  )}
                </TableCell>
                <TableCell>
                  <span aria-hidden="true">{flagEmoji(row.country)}</span>{" "}
                  {countryName(row.country)}
                </TableCell>
                <TableCell className="max-w-[14rem]">
                  {row.listName ? (
                    <span className="block truncate" title={row.listName}>
                      {row.listName}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </TableCell>
                <TableCell>{row.routeName}</TableCell>
                <TableCell className="text-right tabular-nums" data-testid="log-sent">
                  {formatNumber(row.sent)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatSpend(BigInt(row.spendMicro))}
                </TableCell>
                <TableCell className="text-right tabular-nums">{percent(row.ctr)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.clicks)}
                </TableCell>
                <TableCell className="text-right tabular-nums" data-testid="log-cpc">
                  {formatCpc(row.cpcMicro === null ? null : BigInt(row.cpcMicro))}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.leads)}</TableCell>
                <TableCell className="text-right tabular-nums" data-testid="log-sales">
                  {formatNumber(row.sales)}
                  {row.lateSales > 0 ? (
                    <span
                      className="ml-1 text-xs text-amber-700"
                      data-testid="log-late-sales"
                      title="First deposits made this day from an SMS sent on an earlier day"
                    >
                      ({formatNumber(row.lateSales)} late)
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <PaginationBar
        style="page-of"
        page={query.page}
        pageSize={LOG_PAGE_SIZE}
        total={total}
        pageHref={(page) => `/reports/campaigns-log${campaignsLogQueryString({ ...query, page })}`}
        renderLink={(href, children, disabled) => (
          <Link
            href={href}
            aria-disabled={disabled}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-md border border-rule bg-surface px-3 text-sm",
              disabled ? "pointer-events-none opacity-50" : "hover:bg-neutral-100",
            )}
          >
            {children}
          </Link>
        )}
      />
    </section>
  );
}
