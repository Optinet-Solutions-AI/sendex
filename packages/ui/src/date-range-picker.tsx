"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { cn } from "./cn.js";

/** Inclusive ISO days (`YYYY-MM-DD`), blank when open-ended. */
export interface DateRange {
  from: string;
  to: string;
}

export type DatePresetKey = "today" | "yesterday" | "last7" | "last14" | "last30" | "last90";

export const DATE_PRESETS: ReadonlyArray<{ key: DatePresetKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 Days" },
  { key: "last14", label: "Last 14 Days" },
  { key: "last30", label: "Last 30 Days" },
  { key: "last90", label: "Last 90 Days" },
];

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(today: Date, days: number): Date {
  return new Date(today.getTime() - days * 86_400_000);
}

/** The inclusive range a preset means, counted in UTC days up to `today`. */
export function presetRange(key: DatePresetKey, today: Date = new Date()): DateRange {
  const t = isoDay(today);
  switch (key) {
    case "today":
      return { from: t, to: t };
    case "yesterday": {
      const y = isoDay(daysAgo(today, 1));
      return { from: y, to: y };
    }
    case "last7":
      return { from: isoDay(daysAgo(today, 6)), to: t };
    case "last14":
      return { from: isoDay(daysAgo(today, 13)), to: t };
    case "last30":
      return { from: isoDay(daysAgo(today, 29)), to: t };
    case "last90":
      return { from: isoDay(daysAgo(today, 89)), to: t };
  }
}

/** "7 Nov 2026 – 14 Nov 2026", or the one day, or "Date Range" when nothing is set. */
export function describeRange(range: DateRange, label = "Date Range"): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  if (!range.from && !range.to) return label;
  if (range.from && range.to) {
    return range.from === range.to ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`;
  }
  return range.from ? `From ${fmt(range.from)}` : `Until ${fmt(range.to)}`;
}

/**
 * The spec's "📅 Date Range" popover: the presets Today, Yesterday, Last 7 / 14 / 30 / 90
 * Days, then From and To date inputs. Empty means no date filter.
 */
export function DateRangePicker({
  value,
  onChange,
  label = "Date Range",
  today,
  className,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  label?: string;
  /** For tests: the day the presets count back from. */
  today?: Date;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = Boolean(value.from || value.to);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md border border-neutral-300 bg-surface px-3 text-sm hover:bg-neutral-50",
            active ? "text-ink" : "text-muted",
            className,
          )}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          <span>{describeRange(value, label)}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-72 rounded-md border border-rule bg-surface p-2 shadow-md"
        >
          <div className="grid grid-cols-2 gap-1">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  onChange(presetRange(p.key, today));
                  setOpen(false);
                }}
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-neutral-100"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-rule pt-2">
            <label className="text-xs text-muted">
              From
              <input
                type="date"
                value={value.from}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
                aria-label="From"
                className="mt-1 h-8 w-full rounded-md border border-neutral-300 px-2 text-sm text-ink"
              />
            </label>
            <label className="text-xs text-muted">
              To
              <input
                type="date"
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
                aria-label="To"
                className="mt-1 h-8 w-full rounded-md border border-neutral-300 px-2 text-sm text-ink"
              />
            </label>
          </div>
          {active ? (
            <button
              type="button"
              onClick={() => {
                onChange({ from: "", to: "" });
                setOpen(false);
              }}
              className="mt-2 text-xs text-muted underline-offset-2 hover:underline"
            >
              Clear dates
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
