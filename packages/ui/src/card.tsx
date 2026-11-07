import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

/** A white card with a 1 px light border and 8–12 px radius, almost no shadow. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-rule bg-surface", className)} {...props} />;
}

/** Card title row: bold title on the left, grey note and actions on the right. */
export function CardHeader({
  title,
  note,
  actions,
  className,
}: {
  title: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3",
        className,
      )}
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {note ? <span className="text-xs text-muted">{note}</span> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}
