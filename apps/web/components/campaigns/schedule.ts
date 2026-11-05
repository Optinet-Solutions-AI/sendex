import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

/** `<input type="datetime-local">` value, read as wall-clock time in `timezone`, as UTC ISO. */
export function localInputToIso(value: string, timezone: string): string | null {
  if (!LOCAL_INPUT.test(value)) return null;
  const date = fromZonedTime(value, timezone);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A UTC instant as the `datetime-local` value showing `timezone`'s wall clock. */
export function isoToLocalInput(iso: string | null, timezone: string): string {
  if (!iso) return "";
  return formatInTimeZone(iso, timezone, "yyyy-MM-dd'T'HH:mm");
}

export function scheduleNote(country: string, timezone: string): string {
  return `${country} local time; will be sent according to ${timezone}`;
}
