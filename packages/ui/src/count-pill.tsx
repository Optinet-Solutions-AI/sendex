import { cn } from "./cn.js";

/** "187 campaigns", "4,339 contacts": the grey count on the right of a toolbar. */
export function CountPill({
  count,
  noun,
  plural,
  className,
  testId,
}: {
  count: number;
  noun: string;
  plural?: string;
  className?: string;
  testId?: string;
}) {
  const word = count === 1 ? noun : (plural ?? `${noun}s`);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-rule bg-surface px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted",
        className,
      )}
      data-testid={testId}
    >
      {count.toLocaleString("en-GB")} {word}
    </span>
  );
}
