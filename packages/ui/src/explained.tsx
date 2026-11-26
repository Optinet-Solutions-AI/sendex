"use client";

import type { ReactNode } from "react";
import { cn } from "./cn.js";
import { Tooltip } from "./tooltip.js";

/**
 * A computed figure or a header that explains itself (D5-20): hovering it (or focusing it
 * with the keyboard) shows the formula, and, when given, the sum with the real numbers,
 * e.g. "CTR = Clicks ÷ Sent" and "9 ÷ 190 = 4.74%". A dotted underline marks it.
 * Without a formula it renders the value alone.
 */
export function Explained({
  formula,
  working,
  note,
  inButton = false,
  children,
  className,
}: {
  formula: string | null | undefined;
  working?: string | null | undefined;
  /** A short extra line, e.g. which day a figure counts on. */
  note?: string | null | undefined;
  /** Inside a button (a sortable header): hover only, the button keeps the keyboard focus. */
  inButton?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!formula) return <>{children}</>;
  return (
    <Tooltip
      content={
        <span className="block space-y-0.5">
          <span className="block font-medium">{formula}</span>
          {working ? <span className="block font-mono tabular-nums">{working}</span> : null}
          {note ? <span className="block text-white/70">{note}</span> : null}
        </span>
      }
    >
      <span
        tabIndex={inButton ? undefined : 0}
        className={cn(
          "cursor-help underline decoration-dotted decoration-muted/60 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-navy/40",
          className,
        )}
      >
        {children}
      </span>
    </Tooltip>
  );
}
