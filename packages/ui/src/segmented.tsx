"use client";

import { cn } from "./cn.js";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Light grey container, the active option a white pill: the period selectors and Month/Week. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
  className,
  testIdPrefix,
}: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  /** Gives each option `data-testid="<prefix>-<value>"`. */
  testIdPrefix?: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-neutral-200/70 p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md font-medium transition-colors",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}
