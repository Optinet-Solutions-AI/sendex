import { cn } from "./cn.js";

/** A grey bar that pulses while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded bg-neutral-200", className)} />
  );
}

/** Skeleton rows for a table body: `rows` rows of `columns` bars. */
export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  const rowIds = Array.from({ length: rows }, (_, i) => `skeleton-row-${i}`);
  const colIds = Array.from({ length: columns }, (_, i) => `skeleton-col-${i}`);
  return (
    <>
      {rowIds.map((rowId) => (
        <tr key={rowId} data-skeleton="">
          {colIds.map((colId, c) => (
            <td key={colId} className="px-3 py-3">
              <Skeleton className={cn("h-3", c === 0 ? "w-40" : "w-16")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
