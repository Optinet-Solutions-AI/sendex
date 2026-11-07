"use client";

import { countryName, countryOptions, flagEmoji } from "@sendex/core";
import {
  Badge,
  Button,
  ConfirmDialog,
  CountPill,
  CountryMultiSelect,
  cn,
  DateRangePicker,
  EmptyState,
  IconButton,
  PaginationBar,
  useToast,
} from "@sendex/ui";
import { Copy, Download, Eye, Megaphone, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteCampaignAction,
  duplicateCampaignAction,
} from "../../app/(dashboard)/campaigns/actions";
import { type CampaignsQuery, campaignsQueryString } from "../../lib/campaigns-params";
import { formatMicro, formatPercent, formatPeriod, shortId } from "./format";
import type { CampaignStatus, CampaignSummaryView } from "./types";
import { ErrorText, inputClass } from "./ui";

const STATUSES: readonly CampaignStatus[] = [
  "draft",
  "scheduled",
  "sending",
  "paused",
  "stopped",
  "completed",
];

/** The spec shows one badge per campaign: Active while it can send, Paused, Done afterwards. */
const STATUS_LABEL: Record<
  CampaignStatus,
  { label: string; variant: "active" | "warning" | "secondary" }
> = {
  draft: { label: "Active", variant: "active" },
  scheduled: { label: "Active", variant: "active" },
  sending: { label: "Active", variant: "active" },
  paused: { label: "Paused", variant: "warning" },
  stopped: { label: "Done", variant: "secondary" },
  completed: { label: "Done", variant: "secondary" },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const { label, variant } = STATUS_LABEL[status];
  return (
    <Badge variant={variant} data-status={status} title={status}>
      {label}
    </Badge>
  );
}

function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} />
      {label}
    </label>
  );
}

const Dash = () => <span className="text-muted">-</span>;

const COUNTRIES = countryOptions.map((c) => ({ code: c.code, name: c.name, flag: c.flag }));

/**
 * The campaigns list of the spec: search and a count pill, a Filters toggle that reveals the
 * filter row, the table (ID, Campaign, Status, Country, Laps, Sent, Clicks, CTR, Cost,
 * Leads, Sales, Period, Actions), icon row actions with tooltips, "Page 1 of 8 (187 total)".
 */
export function CampaignsTable({
  items,
  total,
  page,
  pageSize,
  filters,
}: {
  items: CampaignSummaryView[];
  total: number;
  page: number;
  pageSize: number;
  filters: CampaignsQuery;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [countries, setCountries] = useState<string[]>(filters.countries);
  const [range, setRange] = useState({ from: filters.from, to: filters.to });
  const filtersActive =
    Boolean(filters.countries.length > 0 || filters.status || filters.from || filters.to) ||
    filters.hasLeads ||
    filters.hasSales ||
    filters.noClicks ||
    Boolean(filters.spendMin || filters.spendMax);
  const [showFilters, setShowFilters] = useState(filtersActive);
  const [deleting, setDeleting] = useState<CampaignSummaryView | null>(null);

  function duplicate(id: string) {
    start(async () => {
      const result = await duplicateCampaignAction({ campaignId: id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/campaigns/${result.data.id}`);
    });
  }

  async function remove(campaign: CampaignSummaryView) {
    const result = await deleteCampaignAction({ campaignId: campaign.id });
    if (!result.ok) throw new Error(result.error);
    toast({ title: "Campaign deleted", variant: "success" });
    router.refresh();
  }

  function pageHref(next: number): string {
    return `/campaigns${campaignsQueryString({ ...filters, page: next })}`;
  }

  const exportHref = `/campaigns/export${campaignsQueryString({ ...filters, page: 1 })}`;

  return (
    <div className="space-y-3">
      <form method="get" action="/campaigns" className="space-y-2" data-testid="campaign-filters">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="search"
            placeholder="Search campaigns…"
            defaultValue={filters.search}
            aria-label="Search"
            className={cn(inputClass, "w-64")}
          />
          <Button type="submit" variant="outline">
            Filter
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-pressed={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
          </Button>
          <CountPill count={total} noun="campaign" className="ml-auto" testId="campaign-count" />
        </div>
        <div className={showFilters ? "flex flex-wrap items-center gap-3" : "hidden"}>
          {countries.map((c) => (
            <input key={c} type="hidden" name="country" value={c} />
          ))}
          <CountryMultiSelect countries={COUNTRIES} value={countries} onChange={setCountries} />
          <select
            name="status"
            defaultValue={filters.status}
            aria-label="Status"
            className={cn(inputClass, "w-40")}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
          <input type="hidden" name="from" value={range.from} />
          <input type="hidden" name="to" value={range.to} />
          <DateRangePicker value={range} onChange={setRange} />
          <Check name="hasLeads" label="Has leads" checked={filters.hasLeads} />
          <Check name="hasSales" label="Has sales" checked={filters.hasSales} />
          <Check name="noClicks" label="No clicks" checked={filters.noClicks} />
          <label className="inline-flex items-center gap-1.5 text-sm">
            Spend above
            <input
              type="text"
              name="spendMin"
              inputMode="decimal"
              defaultValue={filters.spendMin}
              aria-label="Spend above (EUR)"
              placeholder="€"
              className={cn(inputClass, "w-24")}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm">
            below
            <input
              type="text"
              name="spendMax"
              inputMode="decimal"
              defaultValue={filters.spendMax}
              aria-label="Spend below (EUR)"
              placeholder="€"
              className={cn(inputClass, "w-24")}
            />
          </label>
          <Link href="/campaigns" className="text-sm text-muted underline-offset-2 hover:underline">
            Clear
          </Link>
          <Button variant="outline" asChild className="ml-auto">
            <a href={exportHref} data-testid="export-csv">
              <Download className="h-4 w-4" aria-hidden="true" /> Export
            </a>
          </Button>
        </div>
      </form>
      <ErrorText error={error} />
      <div className="overflow-x-auto rounded-lg border border-rule bg-surface [scrollbar-width:thin]">
        <table className="w-full text-sm" data-testid="campaigns-table">
          <thead className="bg-page text-left font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
            <tr>
              <th className="px-3 py-2.5">ID</th>
              <th className="px-3 py-2.5">Campaign</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Country</th>
              <th className="px-3 py-2.5 text-right">Laps</th>
              <th className="px-3 py-2.5 text-right">Sent</th>
              <th className="px-3 py-2.5 text-right">Clicks</th>
              <th className="px-3 py-2.5 text-right">CTR</th>
              <th className="px-3 py-2.5 text-right">Cost</th>
              <th className="px-3 py-2.5 text-right">Leads</th>
              <th className="px-3 py-2.5 text-right">Sales</th>
              <th className="px-3 py-2.5">Period</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={13}>
                  <EmptyState
                    icon={<Megaphone />}
                    title="No campaigns yet"
                    hint={
                      filtersActive || filters.search
                        ? "No campaigns match these filters."
                        : "Create your first campaign to start sending"
                    }
                  />
                </td>
              </tr>
            ) : null}
            {items.map((c) => (
              <tr
                key={c.id}
                className="border-t border-rule hover:bg-neutral-50"
                data-testid="campaign-row"
                data-campaign-id={c.id}
              >
                <td className="px-3 py-2.5 font-mono text-xs text-muted" title={c.id}>
                  {shortId(c.id)}
                </td>
                <td className="max-w-[18rem] px-3 py-2.5">
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <CampaignStatusBadge status={c.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="mr-1.5">{flagEmoji(c.country)}</span>
                  {countryName(c.country)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{c.lapsCount}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {c.sent.toLocaleString("en-GB")}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {c.clicks.toLocaleString("en-GB")}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {formatPercent(c.ctr)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {formatMicro(c.costMicro)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {c.leads > 0 ? c.leads : <Dash />}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {c.sales > 0 ? c.sales : <Dash />}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">
                  {formatPeriod(c.firstLapAt, c.lastLapAt, c.timezone)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <div className="inline-flex items-center">
                    <IconButton
                      label={`View ${c.name}`}
                      tooltip="View campaign"
                      icon={<Eye />}
                      onClick={() => router.push(`/campaigns/${c.id}`)}
                    />
                    <IconButton
                      label={`Duplicate ${c.name}`}
                      tooltip="Duplicate"
                      icon={<Copy />}
                      disabled={pending}
                      onClick={() => duplicate(c.id)}
                    />
                    <IconButton
                      label={`Delete ${c.name}`}
                      tooltip={
                        c.status === "draft" ? "Delete campaign" : "Only drafts can be deleted"
                      }
                      icon={<Trash2 />}
                      tone="danger"
                      disabled={pending || c.status !== "draft"}
                      onClick={() => setDeleting(c)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar
        page={page}
        pageSize={pageSize}
        total={total}
        style="page-of-total"
        pageHref={pageHref}
        renderLink={(href, children, disabled) => (
          <Button
            variant="outline"
            size="sm"
            asChild
            className={disabled ? "pointer-events-none opacity-50" : undefined}
          >
            <Link href={href} aria-disabled={disabled}>
              {children}
            </Link>
          </Button>
        )}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete Campaign"
        description={deleting ? `Delete "${deleting.name}"? This action cannot be undone.` : null}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await remove(deleting);
        }}
      />
    </div>
  );
}
