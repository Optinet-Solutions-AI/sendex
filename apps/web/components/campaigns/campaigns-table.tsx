"use client";

import { countryName, countryOptions, flagEmoji } from "@sendex/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteCampaignAction,
  duplicateCampaignAction,
} from "../../app/(dashboard)/campaigns/actions";
import { formatMicro, formatPercent, formatPeriod, shortId, toCsv } from "./format";
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

export interface CampaignFilters {
  search: string;
  country: string;
  status: string;
  page: number;
}

function downloadCsv(rows: readonly CampaignSummaryView[]): void {
  const csv = toCsv([
    [
      "id",
      "campaign",
      "status",
      "country",
      "laps",
      "sent",
      "clicks",
      "ctr",
      "cost_eur",
      "leads",
      "sales",
      "first_lap",
      "last_lap",
    ],
    ...rows.map((c) => [
      c.id,
      c.name,
      c.status,
      c.country,
      String(c.lapsCount),
      String(c.sent),
      String(c.clicks),
      formatPercent(c.ctr),
      (c.costMicro / 1_000_000).toFixed(2),
      String(c.leads),
      String(c.sales),
      c.firstLapAt ?? "",
      c.lastLapAt ?? "",
    ]),
  ]);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "campaigns.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** Search, filters and the campaigns table with per-row view / duplicate / delete. */
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
  filters: CampaignFilters;
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
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.country) params.set("country", filters.country);
    if (filters.status) params.set("status", filters.status);
    if (next > 1) params.set("page", String(next));
    const query = params.toString();
    return query ? `/campaigns?${query}` : "/campaigns";
  }

  return (
    <div className="space-y-3">
      <form method="get" action="/campaigns" className="flex flex-wrap items-end gap-2">
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
        <Button type="submit">Filter</Button>
        <Button onClick={() => downloadCsv(items)} disabled={items.length === 0}>
          Export CSV
        </Button>
        <span className="ml-auto text-sm text-neutral-600" data-testid="campaign-count">
          {total} {total === 1 ? "campaign" : "campaigns"}
        </span>
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
                  No campaigns yet. Create one with "New Campaign".
                </td>
              </tr>
            ) : null}
            {items.map((c) => (
              <tr key={c.id} className="border-t border-neutral-100" data-testid="campaign-row">
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">{shortId(c.id)}</td>
                <td className="px-3 py-2">
                  <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-3 py-2">
                  <span className="mr-1">{flagEmoji(c.country)}</span>
                  {countryName(c.country)}
                </td>
                <td className="px-3 py-2 text-right">{c.lapsCount}</td>
                <td className="px-3 py-2 text-right">{c.sent}</td>
                <td className="px-3 py-2 text-right">{c.clicks}</td>
                <td className="px-3 py-2 text-right">{formatPercent(c.ctr)}</td>
                <td className="px-3 py-2 text-right">{formatMicro(c.costMicro)}</td>
                <td className="px-3 py-2 text-right">{c.leads}</td>
                <td className="px-3 py-2 text-right">{c.sales}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-neutral-600">
                  {formatPeriod(c.firstLapAt, c.lastLapAt, c.timezone)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="mr-2 text-xs underline"
                    aria-label={`View ${c.name}`}
                  >
                    View
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => duplicate(c.id)}
                    aria-label={`Duplicate ${c.name}`}
                  >
                    Duplicate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || c.status !== "draft"}
                    title={c.status === "draft" ? undefined : "Only drafts can be deleted"}
                    onClick={() => remove(c)}
                    aria-label={`Delete ${c.name}`}
                  >
                    Delete
                  </Button>
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
