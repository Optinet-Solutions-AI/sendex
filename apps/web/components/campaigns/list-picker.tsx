"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@sendex/ui";
import { ChevronDown, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { setCampaignListsAction } from "../../app/(dashboard)/campaigns/actions";
import { filterListsByName } from "./list-filter";
import type { CampaignView, ListOption } from "./types";

const n = (v: number) => v.toLocaleString("en-GB");

/**
 * The Lists row of the send form as a real dropdown (D4-20). It opens under the row with a
 * box to type a list name in; the lists of the campaign country narrow as you type, Enter
 * picks the first match and a click ticks or unticks any of them. Each change is saved at
 * once, as in the Lists tab on the right, which opens alongside for the details (progress,
 * bad numbers, flush) and for the segments.
 */
export function ListPicker({
  campaign,
  lists,
  className,
  onOpen,
  onChanged,
}: {
  campaign: CampaignView;
  lists: readonly ListOption[];
  /** The look of the form's row buttons. */
  className: string;
  /** Called when the dropdown opens, so the form can show the Lists tab next to it. */
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Optimistic, like the Lists tab: the tick flips at once and re-syncs with the server data.
  const fromServer = campaign.lists.map((l) => l.id).join(",");
  const [selected, setSelected] = useState<string[]>(() => campaign.lists.map((l) => l.id));
  useEffect(() => {
    setSelected(fromServer ? fromServer.split(",") : []);
  }, [fromServer]);

  const visible = filterListsByName(lists, query);
  const nothingPicked = campaign.lists.length + campaign.segments.length === 0;

  function toggle(listId: string, checked: boolean) {
    const next = checked
      ? [...new Set([...selected, listId])]
      : selected.filter((id) => id !== listId);
    setSelected(next);
    setError(null);
    start(async () => {
      const result = await setCampaignListsAction({ campaignId: campaign.id, listIds: next });
      if (!result.ok) setError(result.error);
      else onChanged();
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          onOpen();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className={className} aria-label="Lists">
          <span className={nothingPicked ? "text-muted" : "truncate"}>
            {nothingPicked
              ? "Select lists or segments…"
              : [
                  ...campaign.segments.map((seg) => `${seg.name} (segment)`),
                  ...campaign.lists.map((l) => l.name),
                ].join(", ")}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(26rem,calc(100vw-2rem))] p-2"
        data-testid="list-picker"
        onOpenAutoFocus={(event) => {
          // Put the cursor in the search box so a name can be typed straight away.
          event.preventDefault();
          (event.currentTarget as HTMLElement).querySelector("input")?.focus();
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const first = visible[0];
            if (first && !selected.includes(first.id)) toggle(first.id, true);
          }}
          placeholder="Type a list name…"
          aria-label="Search lists by name"
          className="mb-2 h-9 w-full rounded-md border border-neutral-300 px-2.5 text-sm"
        />
        {lists.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted">
            No lists for {campaign.country} yet. Upload one first.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted">No list matches "{query.trim()}".</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {visible.map((list) => (
              <li key={list.id} data-testid="list-picker-option">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-100">
                  <input
                    type="checkbox"
                    aria-label={list.name}
                    checked={selected.includes(list.id)}
                    disabled={pending}
                    onChange={(e) => toggle(list.id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">{list.name}</span>
                  <span className="whitespace-nowrap font-mono text-xs text-muted">
                    {n(list.sent)} / {n(list.numbersCount)} sent
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="px-2 pt-2 text-xs text-signal">{error}</p> : null}
        <div className="mt-2 flex items-center justify-between border-t border-rule px-2 pt-2 text-xs text-muted">
          <span>Enter picks the first match. Segments are in the Lists tab.</span>
          <Link
            href="/lists/upload"
            className="inline-flex items-center gap-1 text-navy hover:underline"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Upload List
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
