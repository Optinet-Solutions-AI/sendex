"use client";

import { Badge, Button, Input, SimpleSelect } from "@sendex/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatMicro } from "../../../../components/campaigns/format";
import { formatDateTime, formatNumber } from "../../../../lib/format";
import {
  POSTBACK_TYPE_FILTERS,
  type PostbackRange,
  type PostbacksQuery,
  type PostbackTypeFilter,
  postbacksQueryString,
} from "../../../../lib/postbacks-params";

export interface PostbackTableRow {
  id: string;
  eventKey: string;
  type: "lead" | "sale";
  dynamicId: string;
  campaignId: string | null;
  campaignName: string | null;
  valueMicro: number | null;
  params: Record<string, unknown>;
  receivedAt: string;
}

interface PostbacksTableProps {
  rows: PostbackTableRow[];
  total: number;
  pageSize: number;
  query: PostbacksQuery;
}

const RANGE_OPTIONS: ReadonlyArray<{ value: PostbackRange; label: string }> = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom dates" },
];

const TYPE_LABELS: Record<PostbackTypeFilter, string> = {
  all: "All",
  lead: "Leads",
  sale: "Sales",
};

/** Parameters other than the ones shown in their own columns, as `key=value` pairs. */
export function summariseParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([key]) => key !== "type" && key !== "dynamic_id")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

export function PostbacksTable({ rows, total, pageSize, query }: PostbacksTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query.search);
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);

  const navigate = (next: Partial<PostbacksQuery>) => {
    router.push(`/reports/postbacks${postbacksQueryString({ ...query, page: 1, ...next })}`);
  };

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ search: search.trim() });
  };

  const onCustomDates = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ range: "custom", from, to });
  };

  const first = total === 0 ? 0 : (query.page - 1) * pageSize + 1;
  const last = Math.min(total, query.page * pageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Postback Logs</h1>
          <p className="mt-1 text-sm text-neutral-600" data-testid="postbacks-count">
            {formatNumber(total)} {total === 1 ? "event" : "events"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/reports/postbacks/export${postbacksQueryString(query)}`}
            className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-100"
          >
            Export CSV
          </a>
          <Link
            href="/settings/postbacks"
            className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-100"
          >
            Postback URL
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <fieldset aria-label="Type" className="inline-flex rounded-md border border-neutral-300">
          {POSTBACK_TYPE_FILTERS.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={query.type === type}
              data-testid={`type-filter-${type}`}
              onClick={() => navigate({ type })}
              className={`px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md ${
                query.type === type
                  ? "bg-neutral-900 text-white"
                  : "bg-white text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {TYPE_LABELS[type]}
            </button>
          ))}
        </fieldset>
        <SimpleSelect
          aria-label="Period"
          className="w-44"
          value={query.range}
          onValueChange={(value) => {
            const range = RANGE_OPTIONS.find((o) => o.value === value)?.value ?? "all";
            if (range === "custom") navigate({ range, from, to });
            else navigate({ range });
          }}
          options={RANGE_OPTIONS}
        />
        {query.range === "custom" ? (
          <form onSubmit={onCustomDates} className="flex items-center gap-2">
            <Input
              type="date"
              aria-label="From"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
            />
            <span className="text-sm text-neutral-500">to</span>
            <Input
              type="date"
              aria-label="To"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
            />
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>
        ) : null}
        <form onSubmit={onSearch} className="flex items-center gap-2">
          <Input
            type="search"
            name="search"
            placeholder="Search event key or dynamic id"
            aria-label="Search postbacks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <div className="mt-4 overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm" data-testid="postbacks-table">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Event key</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Campaign</th>
              <th className="px-3 py-2">Dynamic id</th>
              <th className="px-3 py-2">Parameters</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2">Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                  No postbacks match.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-neutral-100 align-top"
                  data-testid={`postback-row-${row.eventKey}`}
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.eventKey}</td>
                  <td className="px-3 py-2">
                    <Badge variant={row.type === "sale" ? "success" : "secondary"}>
                      {row.type}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {row.campaignId ? (
                      <Link href={`/campaigns/${row.campaignId}`} className="hover:underline">
                        {row.campaignName ?? row.campaignId}
                      </Link>
                    ) : (
                      <span className="text-neutral-400" title="No message carried this dynamic id">
                        unattributed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-600">{row.dynamicId}</td>
                  <td
                    className="max-w-xs truncate px-3 py-2 font-mono text-xs text-neutral-600"
                    title={summariseParams(row.params)}
                  >
                    {summariseParams(row.params)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.valueMicro === null ? "–" : formatMicro(row.valueMicro)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                    {formatDateTime(row.receivedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-neutral-600">
        <span>
          Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={query.page <= 1}
            onClick={() =>
              router.push(
                `/reports/postbacks${postbacksQueryString({ ...query, page: query.page - 1 })}`,
              )
            }
          >
            Previous
          </Button>
          <span>
            Page {query.page} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={query.page >= pages}
            onClick={() =>
              router.push(
                `/reports/postbacks${postbacksQueryString({ ...query, page: query.page + 1 })}`,
              )
            }
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
