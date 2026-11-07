"use client";

import { countryOptions } from "@sendex/core";
import {
  CountryMultiSelect,
  type DateRange,
  DateRangePicker,
  PillTabs,
  SegmentedControl,
} from "@sendex/ui";
import { Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type DashboardQuery,
  type DashboardRange,
  type DashboardTab,
  dashboardQueryString,
} from "../../lib/dashboard-params";

const TABS: ReadonlyArray<{ value: DashboardTab; label: string; icon?: React.ReactNode }> = [
  { value: "getting-started", label: "Getting Started", icon: <Rocket /> },
  { value: "overview", label: "Overview" },
  { value: "roi", label: "ROI" },
  { value: "countries", label: "Countries" },
  { value: "contacts", label: "Contacts" },
  { value: "assets", label: "Assets" },
  { value: "api", label: "API Usage" },
];

const RANGES: ReadonlyArray<{ value: DashboardRange; label: string }> = [
  { value: "all", label: "All time" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "custom", label: "Custom" },
];

const COUNTRIES = countryOptions.map((c) => ({ code: c.code, name: c.name, flag: c.flag }));

/**
 * The tab strip (Getting Started … API Usage) with the global filters on the right: the
 * date range segment and the countries multi-select. Both live in the URL and apply to
 * every tab.
 */
export function DashboardTabs({ query }: { query: DashboardQuery }) {
  const router = useRouter();
  const go = (next: Partial<DashboardQuery>) =>
    router.push(`/${dashboardQueryString({ ...query, ...next })}`, { scroll: false });
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="dashboard-tabs">
      <PillTabs
        label="Dashboard sections"
        value={query.tab}
        tabs={TABS}
        onChange={(tab) => go({ tab })}
      />
      <div className="ml-auto flex flex-wrap items-center gap-2" data-testid="dashboard-filters">
        <SegmentedControl
          label="Date range"
          size="sm"
          testIdPrefix="range"
          value={query.range}
          options={RANGES}
          onChange={(range) => go({ range })}
        />
        {query.range === "custom" ? (
          <DateRangePicker
            value={{ from: query.from, to: query.to }}
            onChange={(range: DateRange) => go({ range: "custom", from: range.from, to: range.to })}
          />
        ) : null}
        <CountryMultiSelect
          countries={COUNTRIES}
          value={query.countries}
          onChange={(countries) => go({ countries })}
          prefix="Countries:"
        />
      </div>
    </div>
  );
}
