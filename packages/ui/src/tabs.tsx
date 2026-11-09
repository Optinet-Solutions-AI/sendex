"use client";

import type { ReactNode } from "react";
import { cn } from "./cn.js";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

interface TabsProps<T extends string> {
  label: string;
  value: T;
  tabs: readonly TabItem<T>[];
  onChange: (value: T) => void;
  className?: string;
}

const thousands = (n: number) => n.toLocaleString("en-GB");

/** Pill style (campaign Status · Logs · Analytics · Send Single): the active tab is a white pill. */
export function PillTabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
  className,
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-neutral-200/70 p-0.5",
        className,
      )}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {t.icon ? <span className="[&>svg]:h-4 [&>svg]:w-4">{t.icon}</span> : null}
            {t.label}
            {t.count !== undefined ? (
              <span className="text-muted">({thousands(t.count)})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Underline style (list details, segments): the active tab has a navy underline. */
export function UnderlineTabs<T extends string>({
  label,
  value,
  tabs,
  onChange,
  className,
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex flex-wrap gap-1 border-b border-rule", className)}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-navy text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.icon ? <span className="[&>svg]:h-4 [&>svg]:w-4">{t.icon}</span> : null}
            {t.label}
            {t.count !== undefined ? (
              <span className="text-muted">({thousands(t.count)})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
