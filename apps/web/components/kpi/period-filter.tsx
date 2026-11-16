"use client";

import { SegmentedControl, SimpleSelect } from "@sendex/ui";
import {
  INSIGHT_FIRST_YEAR,
  type InsightPeriod,
  MONTH_NAMES,
  type PeriodQuery,
} from "../../lib/kpi-params";

const PERIODS: ReadonlyArray<{ value: InsightPeriod; label: string }> = [
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All time" },
];

/** Month / Year / All time with the month and year selects: the period of a KPI screen. */
export function PeriodFilter({
  query,
  thisYear,
  onChange,
}: {
  query: PeriodQuery;
  thisYear: number;
  onChange: (next: Partial<PeriodQuery>) => void;
}) {
  const years = Array.from({ length: thisYear - INSIGHT_FIRST_YEAR + 1 }, (_, i) => thisYear - i);
  return (
    <>
      <SegmentedControl
        label="Period"
        value={query.period}
        options={PERIODS}
        onChange={(period) => onChange({ period })}
      />
      {query.period === "month" ? (
        <SimpleSelect
          aria-label="Month"
          value={String(query.month)}
          onValueChange={(value) => onChange({ month: Number(value) })}
          options={MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }))}
          className="w-40"
        />
      ) : null}
      {query.period !== "all" ? (
        <SimpleSelect
          aria-label="Year"
          value={String(query.year)}
          onValueChange={(value) => onChange({ year: Number(value) })}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
          className="w-28"
        />
      ) : null}
    </>
  );
}
