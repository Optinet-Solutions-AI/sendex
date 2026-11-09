import type { ReactNode } from "react";
import { cn } from "./cn.js";

export interface KpiItem {
  label: ReactNode;
  value: ReactNode;
  /** Small text under the value, e.g. "Never contacted again on this account". */
  hint?: ReactNode;
  tone?: "default" | "good" | "bad";
  testId?: string;
}

/** One bordered card split into equal cells by 1 px rules: grey uppercase label, big number. */
export function KpiStrip({
  items,
  label = "Key figures",
  className,
}: {
  items: readonly KpiItem[];
  label?: string;
  className?: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className={cn(
        "grid min-w-0 gap-px overflow-hidden rounded-lg border border-rule bg-rule",
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.max(110, Math.floor(760 / Math.max(items.length, 1)))}px), 1fr))`,
      }}
    >
      {items.map((item) => (
        <div key={keyOf(item)} className="bg-surface px-4 py-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            {item.label}
          </div>
          <div
            className={cn(
              "mt-1 font-mono text-2xl font-medium tabular-nums leading-tight",
              item.tone === "good" && "text-good",
              item.tone === "bad" && "text-signal",
            )}
            data-testid={item.testId}
          >
            {item.value}
          </div>
          {item.hint ? <div className="mt-0.5 text-xs text-muted">{item.hint}</div> : null}
        </div>
      ))}
    </fieldset>
  );
}

function keyOf(item: KpiItem): string {
  return item.testId ?? (typeof item.label === "string" ? item.label : JSON.stringify(item.label));
}
