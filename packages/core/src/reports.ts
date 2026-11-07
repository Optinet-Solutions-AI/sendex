import { z } from "zod";
import { formatEur } from "./billing.js";

/**
 * Pure maths of the reports (D4-05): the Campaigns Log KPI strip and the Send Calendar's
 * month and week grids, per-day cells and month KPIs. Days are ISO `YYYY-MM-DD` strings in
 * UTC, which is how every date in Sendex is counted.
 */

export interface LogCounters {
  sent: number;
  clicks: number;
  spendMicro: bigint;
  leads: number;
  sales: number;
}

export interface LogKpis extends LogCounters {
  /** Clicks per sent message, 0 without sends. */
  ctr: number;
  /** Spend per click, null without clicks. */
  cpcMicro: bigint | null;
}

/** The KPI strip of the Campaigns Log: SENT · CLICKS · CTR · SPEND · CPC · LEADS / SALES. */
export function logKpis(rows: readonly LogCounters[]): LogKpis {
  let sent = 0;
  let clicks = 0;
  let spendMicro = 0n;
  let leads = 0;
  let sales = 0;
  for (const r of rows) {
    sent += r.sent;
    clicks += r.clicks;
    spendMicro += r.spendMicro;
    leads += r.leads;
    sales += r.sales;
  }
  return {
    sent,
    clicks,
    spendMicro,
    leads,
    sales,
    ctr: sent > 0 ? clicks / sent : 0,
    cpcMicro: clicks > 0 ? spendMicro / BigInt(clicks) : null,
  };
}

/** CPC to four decimals ("€2.1715"); a dash without clicks. */
export function formatCpc(cpcMicro: bigint | null): string {
  if (cpcMicro === null) return "—";
  const negative = cpcMicro < 0n;
  const abs = negative ? -cpcMicro : cpcMicro;
  const euros = abs / 1_000_000n;
  // Four decimals: round the micro remainder to 1/10,000.
  const tenThousandths = (abs % 1_000_000n) / 100n;
  return `${negative ? "-" : ""}€${euros.toLocaleString("en-GB")}.${tenThousandths.toString().padStart(4, "0")}`;
}

/** Spend as the rest of the app shows it ("€1,719.55"). */
export function formatSpend(micro: bigint): string {
  return formatEur(micro);
}

const DAY_MS = 86_400_000;

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(day: string, days: number): string {
  return isoDay(new Date(utcDate(day).getTime() + days * DAY_MS));
}

/** Fixed three-letter months: ICU writes "Sept" in some locales, the spec never does. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(day: string): { d: number; m: string; y: number } {
  const date = utcDate(day);
  return { d: date.getUTCDate(), m: MONTHS[date.getUTCMonth()] ?? "", y: date.getUTCFullYear() };
}

/** "Nov 6, 2026", the spec's log date. */
export function formatLogDay(day: string): string {
  const { d, m, y } = parts(day);
  return `${m} ${d}, ${y}`;
}

/** "6 Nov 2026" for the day modal title. */
export function formatDayLong(day: string): string {
  const { d, m, y } = parts(day);
  return `${d} ${m} ${y}`;
}

/** "November 2026". */
export function formatMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export interface YearMonth {
  year: number;
  /** 1 to 12. */
  month: number;
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export interface DateSpan {
  /** Inclusive, UTC. */
  from: Date;
  /** Exclusive, UTC. */
  to: Date;
}

/** The month as a UTC span, end exclusive. */
export function monthRange(year: number, month: number): DateSpan {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
  };
}

export interface GridCell {
  day: string;
  /** False for the leading and trailing days of the neighbouring months. */
  inMonth: boolean;
}

/** Monday-first weekday index (0 = Monday). */
function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * The month grid of the Send Calendar: rows of Monday to Sunday from the week of the first
 * day to the week of the last, neighbouring months' days included and flagged.
 */
export function monthGrid(year: number, month: number): GridCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first.getTime() - mondayIndex(first) * DAY_MS);
  const weeks: GridCell[][] = [];
  let cursor = start;
  for (;;) {
    const week: GridCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({ day: isoDay(cursor), inMonth: cursor.getUTCMonth() === month - 1 });
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
    weeks.push(week);
    if (cursor.getUTCMonth() !== month - 1 || cursor.getUTCFullYear() !== year) break;
  }
  return weeks;
}

/** The Monday of the week holding `day`. */
export function weekStart(day: string): string {
  return shiftDays(day, -mondayIndex(utcDate(day)));
}

/** One row of seven cells, Monday to Sunday, around `day`. */
export function weekGrid(day: string): GridCell[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => ({ day: shiftDays(start, i), inMonth: true }));
}

/** The week around `day` as a UTC span, end exclusive. */
export function weekRange(day: string): DateSpan {
  const start = weekStart(day);
  return { from: utcDate(start), to: utcDate(shiftDays(start, 7)) };
}

export function shiftWeek(day: string, weeks: number): string {
  return shiftDays(day, weeks * 7);
}

/** One row of the calendar read model: sends of one country on one day. */
export interface CountryDayStats {
  day: string;
  country: string;
  sent: number;
  clicks: number;
  /** Distinct campaigns that sent that day to that country. */
  campaigns: number;
}

export interface CountryLine extends CountryDayStats {
  ctr: number;
}

export interface DayCell {
  day: string;
  sent: number;
  clicks: number;
  /** Sorted by sent, descending. */
  countries: CountryLine[];
  /** The day's sent relative to the busiest day in the set, 0 to 1. */
  barFraction: number;
}

/** Per-day totals with the countries ranked by sent and the bar scaled to the busiest day. */
export function dayCells(stats: readonly CountryDayStats[]): Map<string, DayCell> {
  const cells = new Map<string, DayCell>();
  for (const s of stats) {
    const cell = cells.get(s.day) ?? {
      day: s.day,
      sent: 0,
      clicks: 0,
      countries: [],
      barFraction: 0,
    };
    cell.sent += s.sent;
    cell.clicks += s.clicks;
    cell.countries.push({ ...s, ctr: s.sent > 0 ? s.clicks / s.sent : 0 });
    cells.set(s.day, cell);
  }
  let busiest = 0;
  for (const cell of cells.values()) {
    cell.countries.sort((a, b) => b.sent - a.sent || a.country.localeCompare(b.country));
    busiest = Math.max(busiest, cell.sent);
  }
  for (const cell of cells.values()) {
    cell.barFraction = busiest > 0 ? cell.sent / busiest : 0;
  }
  return cells;
}

export interface CalendarKpis {
  sent: number;
  clicks: number;
  ctr: number;
  /** Distinct countries sent to. */
  countries: number;
  /** Distinct campaign × day pairs. */
  campaignSends: number;
  /** Country × day pairs with sends. */
  countryDays: number;
}

/** The KPI strip of the calendar: Sent · Clicks · CTR · Countries · Campaign sends. */
export function calendarKpis(stats: readonly CountryDayStats[]): CalendarKpis {
  let sent = 0;
  let clicks = 0;
  let campaignSends = 0;
  const countries = new Set<string>();
  for (const s of stats) {
    sent += s.sent;
    clicks += s.clicks;
    campaignSends += s.campaigns;
    countries.add(s.country);
  }
  return {
    sent,
    clicks,
    ctr: sent > 0 ? clicks / sent : 0,
    countries: countries.size,
    campaignSends,
    countryDays: stats.filter((s) => s.sent > 0).length,
  };
}

/** The day modal's request: one UTC day and one country. */
export const calendarDaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "expected an ISO-2 country code"),
});
export type CalendarDayInput = z.infer<typeof calendarDaySchema>;
