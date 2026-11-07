import type { ReactNode } from "react";
import { cn } from "./cn.js";

export interface Crumb {
  label: string;
  href?: string;
}

/** Small grey capitals with › separators; the last crumb is darker and the current page. */
export function Breadcrumb({ items, className }: { items: readonly Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex flex-wrap items-center gap-1", className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        const key = item.href ?? item.label;
        const text = (
          <span
            className={cn(
              "font-mono text-[11px] uppercase tracking-[0.08em]",
              last ? "text-ink" : "text-muted",
            )}
            {...(last ? { "aria-current": "page" as const } : {})}
          >
            {item.label}
          </span>
        );
        return (
          <span key={key} className="flex items-center gap-1">
            {i > 0 ? (
              <span aria-hidden="true" className="text-muted">
                ›
              </span>
            ) : null}
            {item.href && !last ? (
              <a href={item.href} className="hover:underline">
                {text}
              </a>
            ) : (
              text
            )}
          </span>
        );
      })}
    </nav>
  );
}

export interface PageHeaderProps {
  breadcrumb?: readonly Crumb[];
  title: ReactNode;
  /** One grey line that says what the page is for. */
  subtitle?: ReactNode;
  /** Right-aligned: outlined secondary buttons, then one navy primary. */
  actions?: ReactNode;
  /** A badge or status next to the title. */
  titleAside?: ReactNode;
  /** A line under the title: flag, country, "Created …". */
  meta?: ReactNode;
  className?: string;
}

/** The page header every screen in the spec starts with. */
export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  actions,
  titleAside,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-5 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 ? (
          <Breadcrumb items={breadcrumb} className="mb-1" />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {titleAside}
        </div>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        {meta ? <div className="mt-1 text-sm text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
