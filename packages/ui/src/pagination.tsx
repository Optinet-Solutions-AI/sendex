"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button.js";
import { cn } from "./cn.js";

export type PaginationStyle = "page-of-total" | "page-of" | "short" | "showing";

export interface PaginationLabelInput {
  page: number;
  pageSize: number;
  total: number;
  style: PaginationStyle;
  /** For the `showing` style: "contacts", "items". */
  noun?: string;
}

const thousands = (n: number) => n.toLocaleString("en-GB");

export function pageWindow(page: number, pageSize: number, total: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { pageCount, hasPrevious: page > 1, hasNext: page < pageCount };
}

/**
 * The footers SMS Edge uses: "Page 1 of 8 (187 total)" on campaigns, "Page 1 of 2" on the
 * reports, "1 of 6" on lists, "Showing 1 - 25 of 4,339 contacts" on list contacts
 * ("Showing 0-0 of 0 items" when empty).
 */
export function paginationLabel(input: PaginationLabelInput): string {
  const { page, pageSize, total, style } = input;
  const { pageCount } = pageWindow(page, pageSize, total);
  switch (style) {
    case "page-of-total":
      return `Page ${page} of ${pageCount} (${thousands(total)} total)`;
    case "page-of":
      return `Page ${page} of ${pageCount}`;
    case "short":
      return `${page} of ${pageCount}`;
    case "showing": {
      const noun = input.noun ?? "items";
      if (total === 0) return `Showing 0-0 of 0 ${noun}`;
      const from = (page - 1) * pageSize + 1;
      const to = Math.min(total, page * pageSize);
      return `Showing ${thousands(from)} - ${thousands(to)} of ${thousands(total)} ${noun}`;
    }
  }
}

export interface PaginationBarProps extends PaginationLabelInput {
  /** Navigate to a page; links are rendered when `pageHref` is given instead. */
  onPageChange?: (page: number) => void;
  pageHref?: (page: number) => string;
  /** Rendered for `pageHref` navigation; defaults to a plain anchor. */
  renderLink?: (href: string, children: ReactNode, disabled: boolean) => ReactNode;
  className?: string;
}

/** Label on the left, Previous / Next on the right, as every list page in the spec. */
export function PaginationBar({
  onPageChange,
  pageHref,
  renderLink,
  className,
  ...label
}: PaginationBarProps) {
  const { hasPrevious, hasNext } = pageWindow(label.page, label.pageSize, label.total);
  const nav = (to: number, text: ReactNode, enabled: boolean) => {
    if (pageHref) {
      const href = pageHref(to);
      if (renderLink) return renderLink(href, text, !enabled);
      return (
        <a
          href={href}
          aria-disabled={!enabled}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-sm",
            enabled ? "hover:bg-neutral-100" : "pointer-events-none opacity-50",
          )}
        >
          {text}
        </a>
      );
    }
    return (
      <Button variant="outline" size="sm" disabled={!enabled} onClick={() => onPageChange?.(to)}>
        {text}
      </Button>
    );
  };
  return (
    <div
      className={cn("flex flex-wrap items-center justify-between gap-3 text-sm", className)}
      data-testid="pagination"
    >
      <span className="text-neutral-600">{paginationLabel(label)}</span>
      <div className="flex items-center gap-2">
        {nav(
          label.page - 1,
          <>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
          </>,
          hasPrevious,
        )}
        {nav(
          label.page + 1,
          <>
            Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </>,
          hasNext,
        )}
      </div>
    </div>
  );
}
