import { formatEur } from "@sendex/core";

/** Display helpers. Dates render in UTC so server and client markup agree. */

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const number = new Intl.NumberFormat("en-GB");

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return dateTime.format(date);
}

export function formatNumber(value: number): string {
  return number.format(value);
}

/** Micro-EUR as a plain decimal ("4988.31", "-0.04") for CSV cells and form values. */
export function eurDecimal(micro: bigint): string {
  return formatEur(micro).replace("€", "").replace(/,/g, "");
}

/** "13 hours ago", "3 days ago", "just now"; "—" when there is no date. */
export function timeAgo(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  const units: Array<[number, string]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
  ];
  let amount = seconds;
  let unit = "second";
  for (const [size, name] of units) {
    unit = name;
    if (amount < size) break;
    amount = Math.floor(amount / size);
    unit = "year";
  }
  if (unit === "second" && amount < 45) return "just now";
  return `${amount} ${unit}${amount === 1 ? "" : "s"} ago`;
}
