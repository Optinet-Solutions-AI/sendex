"use client";

import { countryName, countryOptions, flagEmoji } from "@sendex/core";
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
import { Button, ErrorText, inputClass, StatusBadge } from "./ui";

const STATUSES: readonly CampaignStatus[] = [
  "draft",
  "scheduled",
  "sending",
  "paused",
  "stopped",
  "completed",
];

function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="inline-flex items-center gap-1 text-sm">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} />
      {label}
    </label>
  );
}

/**
 * Search, filters (country, status, period, leads, sales, spend, no clicks), the campaigns
 * table with a per-row actions menu (view, duplicate, delete) and the CSV export link that
 * carries the same filters.
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
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pages = Math.max(1, Math.ceil(total / pageSize));

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

  function remove(campaign: CampaignSummaryView) {
    if (!window.confirm(`Delete draft "${campaign.name}"? This cannot be undone.`)) return;
    start(async () => {
      const result = await deleteCampaignAction({ campaignId: campaign.id });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function pageHref(next: number): string {
    return `/campaigns${campaignsQueryString({ ...filters, page: next })}`;
  }

  const exportHref = `/campaigns/export${campaignsQueryString({ ...filters, page: 1 })}`;

  return (
    <div className="space-y-3">
      <form method="get" action="/campaigns" className="space-y-2" data-testid="campaign-filters">
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="search"
            name="search"
            placeholder="Search campaigns"
            defaultValue={filters.search}
            aria-label="Search"
            className={`${inputClass} w-56`}
          />
          <select
            name="country"
            defaultValue={filters.country}
            aria-label="Country"
            className={`${inputClass} w-44`}
          >
            <option value="">All countries</option>
            {countryOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={filters.status}
            aria-label="Status"
            className={`${inputClass} w-40`}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            aria-label="From"
            className={`${inputClass} w-40`}
          />
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            aria-label="To"
            className={`${inputClass} w-40`}
          />
          <span className="ml-auto text-sm text-neutral-600" data-testid="campaign-count">
            {total} {total === 1 ? "campaign" : "campaigns"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Check name="hasLeads" label="Has leads" checked={filters.hasLeads} />
          <Check name="hasSales" label="Has sales" checked={filters.hasSales} />
          <Check name="noClicks" label="No clicks" checked={filters.noClicks} />
          <label className="inline-flex items-center gap-1 text-sm">
            Spend above
            <input
              type="text"
              name="spendMin"
              inputMode="decimal"
              defaultValue={filters.spendMin}
              aria-label="Spend above (EUR)"
              placeholder="EUR"
              className={`${inputClass} w-24`}
            />
          </label>
          <label className="inline-flex items-center gap-1 text-sm">
            below
            <input
              type="text"
              name="spendMax"
              inputMode="decimal"
              defaultValue={filters.spendMax}
              aria-label="Spend below (EUR)"
              placeholder="EUR"
              className={`${inputClass} w-24`}
            />
          </label>
          <Button type="submit">Filter</Button>
          <Link href="/campaigns" className="text-sm underline">
            Clear
          </Link>
          <a
            href={exportHref}
            data-testid="export-csv"
            className="ml-auto rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Export CSV
          </a>
        </div>
      </form>
      <ErrorText error={error} />
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm" data-testid="campaigns-table">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Campaign</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2 text-right">Laps</th>
              <th className="px-3 py-2 text-right">Sent</th>
              <th className="px-3 py-2 text-right">Clicks</th>
              <th className="px-3 py-2 text-right">CTR</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-right">Leads</th>
              <th className="px-3 py-2 text-right">Sales</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-6 text-center text-neutral-500">
                  No campaigns match. Clear the filters or create one with "New Campaign".
                </td>
              </tr>
            ) : null}
            {items.map((c) => (
              <tr
                key={c.id}
                className="border-t border-neutral-100"
                data-testid="campaign-row"
                data-campaign-id={c.id}
              >
                <td className="px-3 py-2 font-mono text-xs text-neutral-500" title={c.id}>
                  {shortId(c.id)}
                </td>
                <td className="px-3 py-2">
                  <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-3 py-2" title={countryName(c.country)}>
                  <span className="mr-1">{flagEmoji(c.country)}</span>
                  {c.country}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.lapsCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.sent}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.clicks}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPercent(c.ctr)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMicro(c.costMicro)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.leads}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.sales}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-neutral-600">
                  {formatPeriod(c.firstLapAt, c.lastLapAt, c.timezone)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <details className="relative">
                    <summary
                      className="cursor-pointer list-none rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
                      aria-label={`Actions for ${c.name}`}
                    >
                      Actions ▾
                    </summary>
                    <div className="absolute right-0 z-10 mt-1 flex w-36 flex-col rounded border border-neutral-200 bg-white py-1 text-sm shadow-lg">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="px-3 py-1 text-left hover:bg-neutral-100"
                        aria-label={`View ${c.name}`}
                      >
                        View
                      </Link>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => duplicate(c.id)}
                        aria-label={`Duplicate ${c.name}`}
                        className="px-3 py-1 text-left hover:bg-neutral-100 disabled:text-neutral-400"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        disabled={pending || c.status !== "draft"}
                        title={c.status === "draft" ? undefined : "Only drafts can be deleted"}
                        onClick={() => remove(c)}
                        aria-label={`Delete ${c.name}`}
                        className="px-3 py-1 text-left text-red-700 hover:bg-red-50 disabled:text-neutral-400"
                      >
                        Delete
                      </button>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center gap-2 text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="underline">
              Previous
            </Link>
          ) : null}
          <span className="text-neutral-600">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="underline">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
