"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "./cn.js";

export interface CountryOption {
  code: string;
  name: string;
  flag?: string;
}

export interface CountryMultiSelectProps {
  countries: readonly CountryOption[];
  /** Selected ISO codes; empty means all countries. */
  value: readonly string[];
  onChange: (codes: string[]) => void;
  /** Trigger prefix, e.g. "Countries:" renders "Countries: All". */
  prefix?: string;
  className?: string;
}

/**
 * "All countries ▴▾" opens a searchable checklist: "Search countries…", "✓ All countries",
 * then a code and name per country. Empty selection means every country.
 */
export function CountryMultiSelect({
  countries,
  value,
  onChange,
  prefix,
  className,
}: CountryMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const all = selected.size === 0;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? countries.filter(
          (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
        )
      : countries;
  }, [countries, query]);
  const summary = all
    ? "All countries"
    : selected.size === 1
      ? (countries.find((c) => c.code === value[0])?.name ?? value[0])
      : `${selected.size} countries`;

  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange([...next]);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md border border-neutral-300 bg-surface px-3 text-sm text-ink hover:bg-neutral-50",
            className,
          )}
        >
          {prefix ? <span className="text-muted">{prefix}</span> : null}
          <span>{summary}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-64 rounded-md border border-rule bg-surface p-2 shadow-md"
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search countries…"
            className="mb-2 h-8 w-full rounded-md border border-neutral-300 px-2 text-sm"
          />
          <div className="max-h-64 overflow-y-auto">
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-100">
              <input
                type="checkbox"
                checked={all}
                onChange={() => onChange([])}
                aria-label="All countries"
                className="sr-only"
              />
              <Check
                className={cn("h-4 w-4", all ? "text-navy" : "invisible")}
                aria-hidden="true"
              />
              <span className="font-medium">All countries</span>
            </label>
            {visible.map((c) => {
              const on = selected.has(c.code);
              return (
                <label
                  key={c.code}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-100"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(c.code)}
                    aria-label={`${c.code} ${c.name}`}
                    className="sr-only"
                  />
                  <Check
                    className={cn("h-4 w-4", on ? "text-navy" : "invisible")}
                    aria-hidden="true"
                  />
                  <span className="w-7 font-mono text-xs text-muted">{c.code}</span>
                  <span>
                    {c.flag ? `${c.flag} ` : ""}
                    {c.name}
                  </span>
                </label>
              );
            })}
            {visible.length === 0 ? (
              <div className="px-2 py-2 text-sm text-muted">No match</div>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
