import {
  addMonths,
  type DateSpan,
  monthRange,
  shiftWeek,
  weekRange,
  weekStart,
} from "@sendex/core";
import { parseIsoDay } from "./billing-params";
import type { SearchParams } from "./lists-params";

/**
 * Query-string state of the Send Calendar (D4-05): `/campaigns/scheduled?month=2026-11` for
 * a month, `?view=week&day=2026-11-07` for the week around a day. Nothing set means the
 * current month (UTC).
 */
export const CALENDAR_VIEWS = ["month", "week"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export interface CalendarQuery {
  view: CalendarView;
  year: number;
  /** 1 to 12. */
  month: number;
  /** The focused ISO day: today, or the day a week view is anchored on. */
  day: string;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function isView(value: string): value is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseCalendarQuery(params: SearchParams, now = new Date()): CalendarQuery {
  const viewRaw = first(params.view).trim();
  const view = isView(viewRaw) ? viewRaw : "month";
  const day = parseIsoDay(params.day) || isoDay(now);
  const monthRaw = first(params.month).trim();
  const match = /^(\d{4})-(\d{2})$/.exec(monthRaw);
  const monthNumber = match ? Number.parseInt(match[2] ?? "", 10) : Number.NaN;
  if (match && monthNumber >= 1 && monthNumber <= 12) {
    return { view, year: Number.parseInt(match[1] ?? "", 10), month: monthNumber, day };
  }
  const anchor = new Date(`${day}T00:00:00.000Z`);
  return { view, year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() + 1, day };
}

/** The query string for a state; the current month with nothing set is the empty string. */
export function calendarQueryString(query: CalendarQuery, now = new Date()): string {
  const params = new URLSearchParams();
  if (query.view === "week") {
    params.set("view", "week");
    params.set("day", query.day);
  } else {
    const current = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    if (query.year !== current.year || query.month !== current.month) {
      params.set("month", `${query.year}-${String(query.month).padStart(2, "0")}`);
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** The UTC window the view covers, end exclusive. */
export function calendarSpan(query: CalendarQuery): DateSpan {
  return query.view === "week" ? weekRange(query.day) : monthRange(query.year, query.month);
}

/** The state after pressing ‹ or › (`delta` of -1 or 1). */
export function shiftCalendar(query: CalendarQuery, delta: number): CalendarQuery {
  if (query.view === "week") {
    const day = shiftWeek(weekStart(query.day), delta);
    const anchor = new Date(`${day}T00:00:00.000Z`);
    return { ...query, day, year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() + 1 };
  }
  return { ...query, ...addMonths({ year: query.year, month: query.month }, delta) };
}
