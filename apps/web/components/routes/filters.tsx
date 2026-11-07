"use client";

import { countryOptions } from "@sendex/core";
import {
  Button,
  CountryMultiSelect,
  cn,
  type DateRange,
  DateRangePicker,
  SegmentedControl,
} from "@sendex/ui";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { type RouteRange, type RoutesQuery, routesQueryString } from "../../lib/routes-params";

export const COUNTRIES = countryOptions.map((c) => ({ code: c.code, name: c.name, flag: c.flag }));

const RANGE_LABELS: Record<RouteRange, string> = {
  all: "All time",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  custom: "Custom",
};

/**
 * The filter bar the routes pages share: countries, a search box, a period segment (the set
 * varies per page), extra controls, and ↻ Refresh on the right. State lives in the URL.
 */
export function RoutesFilterBar({
  path,
  query,
  ranges,
  defaultRange = "all",
  searchPlaceholder,
  extra,
  right,
}: {
  path: string;
  query: RoutesQuery;
  ranges: readonly RouteRange[];
  defaultRange?: RouteRange;
  searchPlaceholder: string;
  extra?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const router = useRouter();
  const [q, setQ] = useState(query.q);
  const [refreshing, startRefresh] = useTransition();
  const go = (next: Partial<RoutesQuery>) =>
    router.push(`${path}${routesQueryString({ ...query, page: 1, ...next }, defaultRange)}`);
  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    go({ q: q.trim() });
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="routes-filters">
      <CountryMultiSelect
        countries={COUNTRIES}
        value={query.countries}
        onChange={(countries) => go({ countries })}
      />
      {extra}
      <form onSubmit={onSearch}>
        <input
          type="search"
          aria-label="Search"
          placeholder={searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 w-64 rounded-md border border-neutral-300 bg-surface px-3 text-sm"
          data-testid="routes-search"
        />
      </form>
      <SegmentedControl
        label="Period"
        size="sm"
        testIdPrefix="range"
        value={query.range}
        options={ranges.map((r) => ({ value: r, label: RANGE_LABELS[r] }))}
        onChange={(range) => go({ range })}
      />
      {query.range === "custom" ? (
        <DateRangePicker
          value={{ from: query.from, to: query.to }}
          onChange={(r: DateRange) => go({ range: "custom", from: r.from, to: r.to })}
        />
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {right}
        <Button
          variant="outline"
          size="sm"
          onClick={() => startRefresh(() => router.refresh())}
          data-testid="routes-refresh"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden="true" />{" "}
          Refresh
        </Button>
      </div>
    </div>
  );
}
