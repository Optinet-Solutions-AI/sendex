"use client";

import { SEGMENT_FIELDS, SEGMENT_GROUPS, segmentField } from "@sendex/core";
import { Popover, PopoverContent, PopoverTrigger } from "@sendex/ui";
import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * The spec's field picker: a popover with "Search fields…", fields grouped under headings
 * ("(more)" groups hold the less common ones), a ✓ on the current field and an amber
 * "click data" tag on fields that come from link-click tracking.
 */
export function FieldPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = segmentField(value);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SEGMENT_GROUPS.map((group) => ({
      group,
      fields: SEGMENT_FIELDS.filter(
        (f) => f.group === group && (!q || f.label.toLowerCase().includes(q) || f.key.includes(q)),
      ),
    })).filter((g) => g.fields.length > 0);
  }, [query]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-48 items-center justify-between gap-2 rounded-md border border-neutral-300 bg-surface px-3 text-left text-sm text-ink hover:bg-neutral-50"
          aria-label="Field"
          data-testid="field-picker"
        >
          <span className="truncate">{current?.label ?? "Pick a field…"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="border-b border-rule p-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fields…"
            aria-label="Search fields"
            className="h-8 w-full rounded-md border border-neutral-300 px-2 text-sm"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {groups.map(({ group, fields }) => (
            <div key={group} className="py-1">
              <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                {group}
              </div>
              {fields.map((f) => {
                const active = f.key === value;
                return (
                  <button
                    key={f.key}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(f.key);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
                  >
                    <Check
                      className={`h-3.5 w-3.5 ${active ? "text-navy" : "invisible"}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1">{f.label}</span>
                    {f.clickData ? (
                      <span className="rounded-full bg-amber-soft px-1.5 py-0.5 font-mono text-[10px] text-amber">
                        click data
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
          {groups.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted">No field matches</div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
