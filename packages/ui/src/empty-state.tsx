import type { ReactNode } from "react";
import { cn } from "./cn.js";

/** A grey centred line in the card, with an icon and a second line telling you what to do. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1 px-4 py-10 text-center", className)}>
      {icon ? <div className="mb-1 text-muted [&>svg]:h-7 [&>svg]:w-7">{icon}</div> : null}
      <div className="text-sm font-medium text-ink">{title}</div>
      {hint ? <div className="text-sm text-muted">{hint}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
