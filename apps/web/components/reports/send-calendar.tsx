"use client";

import {
  type CountryLine,
  countryName,
  type DayCell,
  flagEmoji,
  formatDayLong,
  formatMonth,
  type GridCell,
} from "@sendex/core";
import type { CalendarDayCampaign } from "@sendex/db";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  SegmentedControl,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from "@sendex/ui";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { calendarDayAction } from "../../app/(dashboard)/campaigns/scheduled/actions";
import {
  type CalendarQuery,
  type CalendarView,
  calendarQueryString,
  shiftCalendar,
} from "../../lib/calendar-params";
import { formatNumber } from "../../lib/format";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const VIEWS: ReadonlyArray<{ value: CalendarView; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
];
/** Country lines shown per month cell before "+N more countries". */
const MONTH_LINES = 3;

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/** "Poland — 2,000 sent, 47 clicks (2.35%), 1 campaign". */
export function countryTooltip(line: CountryLine): string {
  const campaigns = `${line.campaigns} ${line.campaigns === 1 ? "campaign" : "campaigns"}`;
  return `${countryName(line.country)} — ${formatNumber(line.sent)} sent, ${formatNumber(line.clicks)} clicks (${percent(line.ctr)}), ${campaigns}`;
}

/** "Unit…" style truncation of a country name for the cell line. */
function shortName(country: string, max = 5): string {
  const name = countryName(country);
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export interface SendCalendarProps {
  query: CalendarQuery;
  /** Rows of the grid: six (or fewer) weeks for a month, one for a week. */
  grid: GridCell[][];
  cells: Record<string, DayCell>;
  today: string;
  countryDays: number;
}

/**
 * The Send Calendar grid of the spec: ‹ Today › with the month name and Month | Week, a
 * Monday-first grid whose cells carry the day's total, a navy bar relative to the busiest
 * day and up to three country lines (all of them in the week view). Hovering a line shows
 * the tooltip; clicking it opens the day modal.
 */
export function SendCalendar({ query, grid, cells, today, countryDays }: SendCalendarProps) {
  const router = useRouter();
  const [open, setOpen] = useState<{ day: string; country: string } | null>(null);
  const [rows, setRows] = useState<CalendarDayCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const openDay = (day: string, country: string) => {
    setOpen({ day, country });
    setRows(null);
    setError(null);
    startLoad(async () => {
      const result = await calendarDayAction({ day, country });
      if (result.ok) setRows(result.data);
      else setError(result.error);
    });
  };
  const go = (next: CalendarQuery) =>
    router.push(`/campaigns/scheduled${calendarQueryString(next)}`);
  const title =
    query.view === "week"
      ? `Week of ${formatDayLong(grid[0]?.[0]?.day ?? query.day)}`
      : formatMonth(query.year, query.month);

  return (
    <section className="space-y-3" data-testid="send-calendar">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous"
          data-testid="calendar-prev"
          onClick={() => go(shiftCalendar(query, -1))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="calendar-today"
          onClick={() =>
            router.push(`/campaigns/scheduled${query.view === "week" ? "?view=week" : ""}`)
          }
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next"
          data-testid="calendar-next"
          onClick={() => go(shiftCalendar(query, 1))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h2 className="ml-1 text-base font-semibold text-ink" data-testid="calendar-title">
          {title}
        </h2>
        {/* Days run midnight to midnight UTC, like every report, so "today" can differ from
            the viewer's own date in the hours around midnight. */}
        <span className="text-xs text-muted" data-testid="calendar-utc-note">
          Days in UTC
        </span>
        <SegmentedControl
          label="View"
          size="sm"
          value={query.view}
          options={VIEWS}
          onChange={(view) => go({ ...query, view })}
          className="ml-2"
        />
        <span className="ml-auto text-sm text-muted" data-testid="calendar-country-days">
          {formatNumber(countryDays)} country-{countryDays === 1 ? "day" : "days"} with sends
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-rule bg-surface">
        <div className="grid grid-cols-7 border-b border-rule bg-page">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.07em] text-muted"
            >
              {d}
            </div>
          ))}
        </div>
        {grid.map((week) => (
          <div key={week[0]?.day} className="grid grid-cols-7 border-b border-rule last:border-b-0">
            {week.map((cell) => (
              <DayCellView
                key={cell.day}
                cell={cell}
                stats={cells[cell.day]}
                isToday={cell.day === today}
                lineLimit={query.view === "week" ? Number.POSITIVE_INFINITY : MONTH_LINES}
                tall={query.view === "week"}
                onOpen={(country) => openDay(cell.day, country)}
              />
            ))}
          </div>
        ))}
      </div>

      <DayModal target={open} rows={rows} error={error} onClose={() => setOpen(null)} />
    </section>
  );
}

function DayCellView({
  cell,
  stats,
  isToday,
  lineLimit,
  tall,
  onOpen,
}: {
  cell: GridCell;
  stats: DayCell | undefined;
  isToday: boolean;
  lineLimit: number;
  tall: boolean;
  onOpen: (country: string) => void;
}) {
  const dayNumber = Number.parseInt(cell.day.slice(8, 10), 10);
  const lines = stats?.countries ?? [];
  const shown = lines.slice(0, lineLimit);
  const more = lines.length - shown.length;
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-r border-rule px-2 py-1.5 last:border-r-0",
        tall ? "min-h-[12rem]" : "min-h-[6.5rem]",
        !cell.inMonth && "bg-page/60 text-muted",
      )}
      data-testid="calendar-day"
      data-day={cell.day}
      data-sent={stats?.sent ?? 0}
    >
      <div className="flex items-center justify-between gap-1 text-xs">
        <span
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-full tabular-nums",
            isToday ? "bg-navy font-semibold text-white" : "text-ink",
            !cell.inMonth && !isToday && "text-muted",
          )}
          data-testid={isToday ? "calendar-today-mark" : undefined}
        >
          {dayNumber}
        </span>
        {stats && stats.sent > 0 ? (
          <span className="font-mono tabular-nums text-ink" data-testid="calendar-day-sent">
            {formatNumber(stats.sent)}
          </span>
        ) : null}
      </div>
      {stats && stats.sent > 0 ? (
        <div className="h-0.5 w-full rounded bg-neutral-200">
          <div
            className="h-0.5 rounded bg-navy"
            style={{ width: `${Math.max(4, Math.round(stats.barFraction * 100))}%` }}
            aria-hidden="true"
          />
        </div>
      ) : null}
      <ul className="space-y-0.5">
        {shown.map((line) => (
          <li key={line.country}>
            <Tooltip content={countryTooltip(line)}>
              <button
                type="button"
                onClick={() => onOpen(line.country)}
                className="flex w-full items-center gap-1 rounded px-0.5 text-left text-xs leading-5 hover:bg-neutral-100"
                data-testid="calendar-country-line"
                data-country={line.country}
              >
                <span aria-hidden="true">{flagEmoji(line.country)}</span>
                <span className="truncate text-ink" title={countryName(line.country)}>
                  {tall ? countryName(line.country) : shortName(line.country)}
                </span>
                <span className="ml-auto font-mono tabular-nums text-ink">
                  {formatNumber(line.sent)}
                </span>
                <span className="font-mono tabular-nums text-muted">{percent(line.ctr)}</span>
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <div className="text-[11px] text-muted" data-testid="calendar-more">
          +{more} more {more === 1 ? "country" : "countries"}
        </div>
      ) : null}
    </div>
  );
}

function DayModal({
  target,
  rows,
  error,
  onClose,
}: {
  target: { day: string; country: string } | null;
  /** Null while loading. */
  rows: CalendarDayCampaign[] | null;
  error: string | null;
  onClose: () => void;
}) {
  const totals = (rows ?? []).reduce(
    (t, r) => ({
      sent: t.sent + r.sent,
      clicks: t.clicks + r.clicks,
      leads: t.leads + r.leads,
      sales: t.sales + r.sales,
    }),
    { sent: 0, clicks: 0, leads: 0, sales: 0 },
  );

  return (
    <Dialog open={target !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-3xl" data-testid="calendar-day-modal">
        {target ? (
          <>
            <DialogTitle className="pr-8 text-lg font-semibold">
              <span aria-hidden="true">{flagEmoji(target.country)}</span> Campaigns to{" "}
              {countryName(target.country)} on {formatDayLong(target.day)}
            </DialogTitle>
            <div className="mt-4">
              {error ? (
                <p className="text-sm text-signal">{error}</p>
              ) : rows === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Campaign</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.campaignId ?? "api"} data-testid="calendar-day-row">
                        <TableCell className="max-w-[18rem]">
                          {r.campaignId ? (
                            <Link
                              href={`/campaigns/${r.campaignId}`}
                              className="inline-flex max-w-full items-center gap-1 hover:underline"
                              title={r.campaignName ?? r.campaignId}
                            >
                              <span className="truncate">{r.campaignName ?? r.campaignId}</span>
                              <ExternalLink
                                className="h-3 w-3 shrink-0 text-muted"
                                aria-hidden="true"
                              />
                            </Link>
                          ) : (
                            <span className="text-muted">(API / no campaign)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted">{r.account ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(r.sent)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(r.clicks)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{percent(r.ctr)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(r.leads)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(r.sales)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow
                      className="bg-page font-semibold hover:bg-page"
                      data-testid="calendar-day-total"
                    >
                      <TableCell>TOTAL</TableCell>
                      <TableCell />
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(totals.sent)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(totals.clicks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {percent(totals.sent > 0 ? totals.clicks / totals.sent : 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(totals.leads)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(totals.sales)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
