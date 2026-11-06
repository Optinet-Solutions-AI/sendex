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
