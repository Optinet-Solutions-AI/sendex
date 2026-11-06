"use client";

import { cn } from "@sendex/ui";
import {
  ChevronDown,
  ChevronsLeft,
  LayoutGrid,
  Megaphone,
  Radio,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { activeGroup, activeHref, isSubgroup, type NavGroup } from "./nav";

const ICONS: Record<NavGroup["icon"], ReactNode> = {
  dashboard: <LayoutGrid className="h-5 w-5" aria-hidden="true" />,
  campaigns: <Megaphone className="h-5 w-5" aria-hidden="true" />,
  contacts: <Users className="h-5 w-5" aria-hidden="true" />,
  routes: <Radio className="h-5 w-5" aria-hidden="true" />,
  settings: <Settings className="h-5 w-5" aria-hidden="true" />,
};

/**
 * The dark left rail of the spec: icons only when collapsed (about 72 px); hovering or
 * focusing expands it over the page (about 260 px) with the wordmark, labels and the
 * submenus with chevrons. The active page sits on a rounded darker square and its group
 * starts expanded.
 */
export function Rail({ tree, brand }: { tree: readonly NavGroup[]; brand: ReactNode }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const current = activeHref(pathname, tree);
  const currentGroup = activeGroup(pathname, tree);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (currentGroup) setOpenGroups((g) => ({ ...g, [currentGroup]: true }));
  }, [currentGroup]);

  const wide = expanded || pinnedOpen;
  const toggleGroup = (label: string) =>
    setOpenGroups((g) => ({ ...g, [label]: !(g[label] ?? false) }));

  return (
    <nav
      aria-label="Main"
      data-expanded={wide ? "true" : "false"}
      className="relative z-30 w-[72px] shrink-0"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setExpanded(false);
      }}
    >
      <div
        className={cn(
          "fixed inset-y-0 left-0 flex flex-col bg-rail text-neutral-300 transition-[width] duration-150 ease-out",
          wide ? "w-[260px] shadow-xl" : "w-[72px]",
        )}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <Link href="/" className="flex items-center gap-2 text-white" aria-label="Sendex home">
            {brand}
            <span className={cn("text-lg font-bold tracking-tight", !wide && "sr-only")}>
              Sendex
            </span>
          </Link>
          {wide ? (
            <button
              type="button"
              aria-label={pinnedOpen ? "Collapse sidebar" : "Keep sidebar open"}
              aria-pressed={pinnedOpen}
              onClick={() => setPinnedOpen((p) => !p)}
              className="ml-auto rounded p-1 text-neutral-400 hover:bg-rail-hover hover:text-white"
            >
              <ChevronsLeft
                className={cn("h-4 w-4 transition-transform", !pinnedOpen && "rotate-180")}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </div>
        <ul className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {tree.map((group) => {
            const groupActive = currentGroup === group.label;
            const open = openGroups[group.label] ?? groupActive;
            const base =
              "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors";
            const tone = groupActive
              ? "bg-rail-active text-white"
              : "text-neutral-300 hover:bg-rail-hover hover:text-white";
            if (group.href && !group.children) {
              return (
                <li key={group.label}>
                  <Link
                    href={group.href}
                    className={cn(base, tone)}
                    aria-current={current === group.href ? "page" : undefined}
                    title={wide ? undefined : group.label}
                  >
                    {ICONS[group.icon]}
                    <span className={cn(!wide && "sr-only")}>{group.label}</span>
                  </Link>
                </li>
              );
            }
            return (
              <li key={group.label}>
                <button
                  type="button"
                  className={cn(base, tone)}
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.label)}
                  title={wide ? undefined : group.label}
                >
                  {ICONS[group.icon]}
                  <span className={cn("flex-1 text-left", !wide && "sr-only")}>{group.label}</span>
                  {wide ? (
                    <ChevronDown
                      className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
                {wide && open ? (
                  <ul className="mt-1 ml-3 space-y-0.5 border-l border-rail-active pl-2">
                    {group.children?.map((entry) =>
                      isSubgroup(entry) ? (
                        <li key={entry.label}>
                          <div className="px-2.5 pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-neutral-500">
                            {entry.label}
                          </div>
                          <ul className="space-y-0.5">
                            {entry.children.map((leaf) => (
                              <li key={leaf.href}>
                                <RailLink
                                  href={leaf.href}
                                  active={current === leaf.href}
                                  label={leaf.label}
                                />
                              </li>
                            ))}
                          </ul>
                        </li>
                      ) : (
                        <li key={entry.href}>
                          <RailLink
                            href={entry.href}
                            active={current === entry.href}
                            label={entry.label}
                          />
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p
          className={cn(
            "mt-auto truncate px-4 py-3 font-mono text-[11px] text-neutral-500",
            !wide && "sr-only",
          )}
          data-testid="app-version"
        >
          Sendex {process.env.NEXT_PUBLIC_SENDEX_VERSION ?? "dev"}
        </p>
      </div>
    </nav>
  );
}

function RailLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-rail-active text-white"
          : "text-neutral-400 hover:bg-rail-hover hover:text-white",
      )}
    >
      {label}
    </Link>
  );
}
