/**
 * Suggested sending hours (D4-14, decisions item 34). The team has suggested hours per
 * country; sending outside them shows a notice and never stops a campaign ("it's just a
 * suggestion"). The hours are entered in Settings, as a default window plus per-country
 * windows, and are compared in the campaign's own time zone. Pure, shared by the settings
 * form, the server action and the send form.
 */
import { z } from "zod";

/** A window of a day in local time, `from` inclusive and `to` exclusive, both "HH:MM". */
export interface HoursWindow {
  from: string;
  to: string;
}

export interface SendingHours {
  /** For every country without its own window; null when none is set. */
  default: HoursWindow | null;
  /** ISO-2 country code to its window. */
  countries: Record<string, HoursWindow>;
}

export const EMPTY_SENDING_HOURS: SendingHours = { default: null, countries: {} };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const hoursWindowSchema = z
  .object({
    from: z.string().regex(TIME, "use HH:MM, for example 09:00"),
    to: z.string().regex(TIME, "use HH:MM, for example 20:00"),
  })
  .refine((w) => w.from < w.to, { message: "the hours must end after they start" });

export const sendingHoursSchema = z.object({
  default: hoursWindowSchema.nullable(),
  countries: z.record(
    z.string().regex(/^[A-Z]{2}$/, "use a 2-letter country code"),
    hoursWindowSchema,
  ),
});

/** The window that applies to a country: its own, else the default, else none. */
export function sendingHoursFor(hours: SendingHours, country: string): HoursWindow | null {
  return hours.countries[country.toUpperCase()] ?? hours.default;
}

/** "21:05" in the given time zone. */
function localTimeOf(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/**
 * Null when `at` is inside the suggested hours for the country, or when none are set.
 * Otherwise the window and the local time, for the notice.
 */
export function outsideSendingHours(
  hours: SendingHours,
  country: string,
  timezone: string,
  at: Date,
): { window: HoursWindow; localTime: string } | null {
  const window = sendingHoursFor(hours, country);
  if (window === null) return null;
  const localTime = localTimeOf(at, timezone);
  if (localTime >= window.from && localTime < window.to) return null;
  return { window, localTime };
}

const LINE = /^([A-Za-z]{2})\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/;

export type SendingHoursTextResult =
  | { ok: true; countries: Record<string, HoursWindow> }
  | { ok: false; error: string };

/** The per-country box of the settings form: one "ES 10:00-21:00" per line, blank lines skipped. */
export function parseSendingHoursText(text: string): SendingHoursTextResult {
  const countries: Record<string, HoursWindow> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    const match = LINE.exec(line);
    const [, code, from, to] = match ?? [];
    if (!code || !from || !to || !TIME.test(from) || !TIME.test(to)) {
      return { ok: false, error: `Line ${i + 1} is not "CC HH:MM-HH:MM": ${line}` };
    }
    if (from >= to) {
      return { ok: false, error: `Line ${i + 1}: the hours must end after they start: ${line}` };
    }
    countries[code.toUpperCase()] = { from, to };
  }
  return { ok: true, countries };
}

/** The per-country windows as the text box shows them, sorted by country code. */
export function formatSendingHoursText(countries: Record<string, HoursWindow>): string {
  return Object.keys(countries)
    .sort()
    .map((code) => `${code} ${countries[code]?.from ?? ""}-${countries[code]?.to ?? ""}`)
    .join("\n");
}

/** The settings form as posted: the two default times (both or neither) and the country box. */
export const sendingHoursFormSchema = z.object({
  defaultFrom: z.string().trim().max(5),
  defaultTo: z.string().trim().max(5),
  countriesText: z.string().max(10_000),
});
export type SendingHoursForm = z.infer<typeof sendingHoursFormSchema>;

export type SendingHoursFormResult =
  | { ok: true; hours: SendingHours }
  | { ok: false; error: string };

/** Turn the settings form into sending hours, with a plain message for the first problem. */
export function sendingHoursFromForm(form: SendingHoursForm): SendingHoursFormResult {
  const from = form.defaultFrom.trim();
  const to = form.defaultTo.trim();
  let fallback: HoursWindow | null = null;
  if (from !== "" || to !== "") {
    if (from === "" || to === "") {
      return { ok: false, error: "Fill in both default times, or leave both empty." };
    }
    if (!TIME.test(from) || !TIME.test(to)) {
      return { ok: false, error: "Write the default times as HH:MM, for example 09:00." };
    }
    if (from >= to) return { ok: false, error: "The default hours must end after they start." };
    fallback = { from, to };
  }
  const parsed = parseSendingHoursText(form.countriesText);
  if (!parsed.ok) return parsed;
  return { ok: true, hours: { default: fallback, countries: parsed.countries } };
}
