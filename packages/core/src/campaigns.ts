/**
 * Campaign form schemas, country/timezone tables and message placeholders.
 * Pure: validated at every boundary (server actions, queries) and reused by the UI.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Countries and timezones
// ---------------------------------------------------------------------------

/** ISO 3166-1 alpha-2 → IANA zone used for scheduling and reporting. */
export const COUNTRY_TIMEZONES: Readonly<Record<string, string>> = {
  ES: "Europe/Madrid",
  FR: "Europe/Paris",
  GB: "Europe/London",
  DE: "Europe/Berlin",
  PL: "Europe/Warsaw",
  FI: "Europe/Helsinki",
  NZ: "Pacific/Auckland",
  AU: "Australia/Sydney",
  MT: "Europe/Malta",
  PT: "Europe/Lisbon",
  IT: "Europe/Rome",
  IE: "Europe/Dublin",
  NL: "Europe/Amsterdam",
  AT: "Europe/Vienna",
  DZ: "Africa/Algiers",
  AL: "Europe/Tirane",
  CA: "America/Toronto",
  US: "America/New_York",
  PH: "Asia/Manila",
};

const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  ES: "Spain",
  FR: "France",
  GB: "United Kingdom",
  DE: "Germany",
  PL: "Poland",
  FI: "Finland",
  NZ: "New Zealand",
  AU: "Australia",
  MT: "Malta",
  PT: "Portugal",
  IT: "Italy",
  IE: "Ireland",
  NL: "Netherlands",
  AT: "Austria",
  DZ: "Algeria",
  AL: "Albania",
  CA: "Canada",
  US: "United States",
  PH: "Philippines",
};

/** The zone a campaign for `country` is scheduled in; UTC for countries not in the table. */
export function timezoneForCountry(country: string): string {
  return COUNTRY_TIMEZONES[country.toUpperCase()] ?? "UTC";
}

/** Every zone in the table plus UTC, each once, sorted: the options of the timezone select. */
export const timezoneOptions: readonly string[] = [
  ...new Set([...Object.values(COUNTRY_TIMEZONES), "UTC"]),
].sort();

/** Regional indicator symbols for an ISO-2 code, e.g. ES → 🇪🇸. */
export function flagEmoji(country: string): string {
  const code = country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code].map((ch) => 0x1f1e6 + (ch.charCodeAt(0) - "A".charCodeAt(0))),
  );
}

export interface CountryOption {
  code: string;
  name: string;
  flag: string;
}

/** Countries the platform sells routes for, sorted by name. */
export const countryOptions: readonly CountryOption[] = Object.keys(COUNTRY_TIMEZONES)
  .map((code) => ({ code, name: COUNTRY_NAMES[code] ?? code, flag: flagEmoji(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function countryName(country: string): string {
  return COUNTRY_NAMES[country.toUpperCase()] ?? country.toUpperCase();
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Country must be an ISO-2 code such as ES");

export const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone is required")
  .refine(isIanaTimezone, "Timezone must be an IANA zone such as Europe/Madrid");

export const newCampaignSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is at most 120 characters"),
  country: countrySchema,
  timezone: timezoneSchema,
});
export type NewCampaign = z.infer<typeof newCampaignSchema>;

export const sidGroupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  country: countrySchema,
});
export type SidGroupInput = z.infer<typeof sidGroupSchema>;

const SENDER_ID_PATTERN = /^[A-Za-z0-9]{3,11}$/;

/** Split a textarea (one per line or comma separated), trim, drop blanks, keep first of duplicates. */
export function parseSenderIds(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\n,]/)) {
    const value = raw.trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** The "Add SIDs" textarea: resolves to the deduped list of valid sender ids. */
export const senderIdsInputSchema = z
  .string()
  .transform(parseSenderIds)
  .superRefine((values, ctx) => {
    if (values.length === 0) {
      ctx.addIssue({ code: "custom", message: "Enter at least one sender id" });
      return;
    }
    for (const value of values) {
      if (!SENDER_ID_PATTERN.test(value)) {
        ctx.addIssue({
          code: "custom",
          message: `"${value}" must be 3 to 11 letters or digits`,
        });
      }
    }
  });

export const adTextSchema = z.object({
  text: z.string().min(1, "Text is required").max(1000, "Text is at most 1000 characters"),
});
export type AdTextInput = z.infer<typeof adTextSchema>;

/** Several texts in one textarea are separated by a line containing only `//`. */
export function splitAdTexts(input: string): string[] {
  return input
    .split(/\r?\n[ \t]*\/\/[ \t]*(?:\r?\n|$)|^[ \t]*\/\/[ \t]*\r?\n/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

const PLACEHOLDER_PATTERN = /\{\{\s*[a-z0-9_]+\s*\}\}/gi;

function isHttpUrlWithPlaceholders(value: string): boolean {
  try {
    const url = new URL(value.replace(PLACEHOLDER_PATTERN, "x"));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const linkSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  url: z
    .string()
    .trim()
    .min(1, "URL is required")
    .max(2000)
    .refine(isHttpUrlWithPlaceholders, "URL must start with http:// or https://"),
  /** Revenue per conversion in EUR (Advanced › Profit); 0 when unknown. */
  profitEur: z.coerce.number().min(0).max(1_000_000).default(0),
});
export type LinkInput = z.infer<typeof linkSchema>;

export const CONTACT_REUSE = ["account_wide", "per_campaign"] as const;
export type ContactReuse = (typeof CONTACT_REUSE)[number];

export const sendSettingsSchema = z
  .object({
    testSize: z.coerce.number().int().min(1).max(100_000).default(200),
    contactReuse: z.enum(CONTACT_REUSE).default("account_wide"),
    sendAll: z.boolean().default(false),
    sendNow: z.boolean().default(true),
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    /** Run AutoSender: a test batch first, then scale out the best message and route. Left alone when absent. */
    autosender: z.boolean().optional(),
  })
  .refine((v) => v.sendNow || v.scheduledAt !== undefined, {
    message: "Pick a start time or send now",
    path: ["scheduledAt"],
  });
export type SendSettings = z.infer<typeof sendSettingsSchema>;

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

export interface TextPlaceholder {
  key: string;
  /** What is inserted into the editor when the chip is clicked. */
  token: string;
  description: string;
}

export const TEXT_PLACEHOLDERS: readonly TextPlaceholder[] = [
  { key: "domain", token: "{{domain}}", description: "Tracked short link of the active offer" },
  { key: "first_name", token: "{{first_name}}", description: "Contact first name" },
  { key: "last_name", token: "{{last_name}}", description: "Contact last name" },
  { key: "phone", token: "{{phone}}", description: "Contact phone number" },
  { key: "opt_out", token: "{{opt_out}}", description: "Opt-out instruction for the route" },
  {
    key: "random",
    token: "{word1|word2|word3}",
    description: "Words randomizer: one option is picked per message",
  },
];

export const LINK_PLACEHOLDERS: readonly string[] = [
  "dynamic",
  "geo",
  "ad_text_id",
  "list_id",
  "phone",
  "first_name",
  "last_name",
  "email",
  "campaign_id",
  "campaign_name",
  "route_name",
  "custom1",
  "custom2",
  "custom3",
  "custom4",
  "custom5",
  "link_id",
  "cost",
];

export function hasDomainPlaceholder(text: string): boolean {
  return /\{\{\s*domain\s*\}\}/i.test(text);
}

export type PreviewSample = Readonly<Partial<Record<string, string>>>;

/**
 * Fill `{{key}}` placeholders from `sample` (unknown keys are left as they are) and resolve
 * `{a|b|c}` randomizers to their first option so previews are deterministic.
 */
export function renderPreview(text: string, sample: PreviewSample): string {
  return text
    .replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key: string) => sample[key] ?? match)
    .replace(/\{([^{}|]*(?:\|[^{}|]*)+)\}/g, (_match, options: string) => {
      const first = options.split("|")[0];
      return first ?? "";
    });
}

// ---------------------------------------------------------------------------
// Laps: budget top-up, comment, reschedule
// ---------------------------------------------------------------------------

/** A budget top-up in EUR (the €5–€200 buttons or the Custom dialog). */
export const topUpSchema = z.object({
  amountEur: z.coerce.number().positive().max(100_000),
});
export type TopUpInput = z.infer<typeof topUpSchema>;

/** The lap note from "Add comment"; blank clears it. */
export const lapCommentSchema = z.object({
  comment: z.string().trim().max(500),
});

/** "Reschedule" a queued lap to a later start. */
export const lapScheduleSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true }),
});
