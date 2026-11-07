"use client";

import { cn, Dialog, DialogContent, DialogTitle } from "@sendex/ui";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { NavPage } from "./nav";

/**
 * "Search pages…" with a Ctrl K hint: a palette listing every page in the rail, filtered as
 * you type, Enter opens the highlighted one.
 */
export function SearchPalette({ pages }: { pages: readonly NavPage[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? pages.filter((p) => [p.label, ...p.path].some((part) => part.toLowerCase().includes(q)))
      : pages;
    return list.slice(0, 12);
  }, [pages, query]);

  const go = (page: NavPage | undefined) => {
    if (!page) return;
    setOpen(false);
    setQuery("");
    router.push(page.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-64 items-center gap-2 rounded-md border border-neutral-300 bg-surface px-3 text-sm text-muted hover:bg-neutral-50 md:inline-flex"
        aria-label="Find a page"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="flex-1 text-left">Search pages…</span>
        <kbd className="rounded border border-rule bg-page px-1.5 font-mono text-[10px] text-muted">
          Ctrl K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-24 max-w-lg translate-y-0 p-0">
          <DialogTitle className="sr-only">Find a page</DialogTitle>
          <div className="flex items-center gap-2 border-b border-rule px-3">
            <Search className="h-4 w-4 text-muted" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  go(results[cursor]);
                }
              }}
              placeholder="Search pages…"
              aria-label="Find a page"
              className="h-11 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto p-1" aria-label="Pages">
            {results.map((page, i) => (
              <li key={page.href}>
                <button
                  type="button"
                  onClick={() => go(page)}
                  onMouseEnter={() => setCursor(i)}
                  className={cn(
                    "flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm",
                    i === cursor ? "bg-navy-soft text-ink" : "text-ink hover:bg-neutral-100",
                  )}
                >
                  <span>{page.label}</span>
                  {page.path.length > 0 ? (
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
                      {page.path.join(" › ")}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {results.length === 0 ? (
              <li className="px-3 py-4 text-sm text-muted">No page matches</li>
            ) : null}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
