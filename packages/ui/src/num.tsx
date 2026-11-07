import { cn } from "./cn.js";

/** Right-aligned monospace number with thousands separators; "–" for null. */
export function Num({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  dash = "–",
  className,
}: {
  value: number | bigint | null | undefined;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  dash?: string;
  className?: string;
}) {
  if (value === null || value === undefined) {
    return <span className={cn("font-mono tabular-nums text-muted", className)}>{dash}</span>;
  }
  const text =
    typeof value === "bigint"
      ? value.toLocaleString("en-GB")
      : value.toLocaleString("en-GB", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {prefix}
      {text}
      {suffix}
    </span>
  );
}
