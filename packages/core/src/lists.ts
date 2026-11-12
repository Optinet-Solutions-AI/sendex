import { z } from "zod";
import { flagEmoji } from "./campaigns.js";

export { flagEmoji };

import {
  type CountryCode,
  type DroppedNumber,
  type DropReason,
  isSuspiciousPattern,
  logicalCheck,
  normalisePhone,
} from "./phone.js";

/**
 * List upload: the countries a list can be for, the upload settings form, the CSV column
 * mapping and its auto-detection. Pure, so the browser and the server action share it.
 */

export const LIST_COUNTRY_CODES = [
  "ES",
  "FR",
  "GB",
  "DE",
  "PL",
  "FI",
  "NZ",
  "AU",
  "MT",
  "PT",
  "IT",
  "IE",
  "NL",
  "AT",
  "CA",
  "US",
  "DZ",
  "AL",
  "PH",
] as const;
export type ListCountry = (typeof LIST_COUNTRY_CODES)[number];

export interface CountryInfo {
  code: ListCountry;
  name: string;
  flag: string;
}

const COUNTRY_NAMES: Record<ListCountry, string> = {
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
  CA: "Canada",
  US: "United States",
  DZ: "Algeria",
  AL: "Albania",
  PH: "Philippines",
};

/** Regional indicator pair for an ISO-2 code, e.g. "GB" -> 🇬🇧. */

/** The countries a list can be uploaded for, in the order the UI shows them. */
export const countriesList: readonly CountryInfo[] = LIST_COUNTRY_CODES.map((code) => ({
  code,
  name: COUNTRY_NAMES[code],
  flag: flagEmoji(code),
}));

export function countryByCode(code: string): CountryInfo | undefined {
  return countriesList.find((c) => c.code === code.toUpperCase());
}

export const ListCountrySchema = z.enum(LIST_COUNTRY_CODES);

export const NewListSchema = z.object({
  name: z.string().trim().min(1).max(100),
  country: ListCountrySchema,
});
export type NewList = z.infer<typeof NewListSchema>;

export const UploadTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), listId: z.uuid() }),
  z.object({ kind: z.literal("new"), ...NewListSchema.shape }),
]);
export type UploadTarget = z.infer<typeof UploadTargetSchema>;

/** Columns the lists table can be sorted by; the db query maps them to SQL. */
export const LIST_SORT_KEYS = [
  "name",
  "numbersCount",
  "country",
  "sent",
  "ctr",
  "leads",
  "sales",
  "spend",
  "lastSentAt",
  "lastUploadAt",
  "createdAt",
] as const;
export type ListSortKey = (typeof LIST_SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export function isListSortKey(value: unknown): value is ListSortKey {
  return typeof value === "string" && (LIST_SORT_KEYS as readonly string[]).includes(value);
}

export const DUPLICATE_MODES = ["allow", "skip_existing"] as const;
export type DuplicateMode = (typeof DUPLICATE_MODES)[number];

/**
 * Settings of one upload. `logicalCheck` drops landlines, premium and toll-free numbers;
 * `duplicates` says what to do with numbers the organisation already has as contacts;
 * `flushAfterImport` resets the sent flags of the whole list once the rows are in.
 */
export const UploadSettingsSchema = z.object({
  target: UploadTargetSchema,
  logicalCheck: z.boolean().default(true),
  duplicates: z.enum(DUPLICATE_MODES).default("skip_existing"),
  flushAfterImport: z.boolean().default(false),
});
export type UploadSettings = z.infer<typeof UploadSettingsSchema>;
export type UploadSettingsInput = z.input<typeof UploadSettingsSchema>;

/** Field types of the import grid, in SMS Edge's order ("-- Ignore --" first). */
export const COLUMN_TYPES = [
  "ignore",
  "phone",
  "country",
  "email",
  "first_name",
  "last_name",
  "date_of_birth",
  "gender",
  "state",
  "address",
  "custom1",
  "custom2",
  "custom3",
  "custom4",
  "custom5",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export const ColumnTypeSchema = z.enum(COLUMN_TYPES);

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  ignore: "-- Ignore --",
  phone: "Phone Number",
  country: "Country",
  email: "Email",
  first_name: "Name",
  last_name: "Last Name",
  date_of_birth: "Date of Birth",
  gender: "Gender",
  state: "State",
  address: "Address",
  custom1: "Custom 1",
  custom2: "Custom 2",
  custom3: "Custom 3",
  custom4: "Custom 4",
  custom5: "Custom 5",
};

/** Column index -> type. Exactly one phone column; no other field used twice. */
export const ColumnMappingSchema = z
  .array(ColumnTypeSchema)
  .min(1)
  .refine((m) => m.filter((t) => t === "phone").length === 1, {
    message: "Pick exactly one phone column",
  })
  .refine(
    (m) => {
      const used = m.filter((t) => t !== "ignore");
      return new Set(used).size === used.length;
    },
    { message: "Each field can be used only once" },
  );
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

/** One row as sent to the import action: the raw phone plus optional contact fields. */
export const UploadRowSchema = z.object({
  phone: z.string().min(1).max(64),
  /** Raw country cell; when it reads as a country, national numbers are parsed against it. */
  country: z.string().max(100).optional(),
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  dateOfBirth: z.string().max(50).optional(),
  gender: z.string().max(50).optional(),
  state: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  custom1: z.string().max(500).optional(),
  custom2: z.string().max(500).optional(),
  custom3: z.string().max(500).optional(),
  custom4: z.string().max(500).optional(),
  custom5: z.string().max(500).optional(),
});
export type UploadRow = z.infer<typeof UploadRowSchema>;

/** Rows travel to the server in chunks of this size so a 100k-row file stays within limits. */
export const UPLOAD_CHUNK_SIZE = 5_000;

const FIELD_FOR_TYPE: Record<Exclude<ColumnType, "phone" | "ignore">, keyof UploadRow> = {
  country: "country",
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  date_of_birth: "dateOfBirth",
  gender: "gender",
  state: "state",
  address: "address",
  custom1: "custom1",
  custom2: "custom2",
  custom3: "custom3",
  custom4: "custom4",
  custom5: "custom5",
};

/** Build an upload row from a parsed CSV row and a column mapping. Blank cells are dropped. */
export function applyMapping(cells: readonly string[], mapping: ColumnMapping): UploadRow {
  const row: UploadRow = { phone: "" };
  mapping.forEach((type, index) => {
    if (type === "ignore") return;
    const value = (cells[index] ?? "").trim();
    if (type === "phone") {
      row.phone = value;
      return;
    }
    if (value.length > 0) row[FIELD_FOR_TYPE[type]] = value;
  });
  return row;
}

const COUNTRY_BY_NAME = new Map<string, ListCountry>([
  ...LIST_COUNTRY_CODES.map((code) => [COUNTRY_NAMES[code].toLowerCase(), code] as const),
  ["uk", "GB"],
  ["great britain", "GB"],
  ["england", "GB"],
  ["usa", "US"],
  ["españa", "ES"],
  ["espana", "ES"],
]);

/** Read a country cell: an ISO-2 code, "UK" or a country name, in any case. */
export function parseCountryCell(value: string): ListCountry | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const code = trimmed.toUpperCase();
  if ((LIST_COUNTRY_CODES as readonly string[]).includes(code)) return code as ListCountry;
  return COUNTRY_BY_NAME.get(trimmed.toLowerCase());
}

/**
 * "Auto-detect from file": the list country is the most common readable value of the
 * country column. Undefined when there is no country column or nothing in it reads.
 */
export function detectListCountry(
  rows: ReadonlyArray<readonly string[]>,
  mapping: readonly ColumnType[],
): ListCountry | undefined {
  const index = mapping.indexOf("country");
  if (index < 0) return undefined;
  const counts = new Map<ListCountry, number>();
  for (const row of rows) {
    const country = parseCountryCell(row[index] ?? "");
    if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  let best: ListCountry | undefined;
  let bestCount = 0;
  for (const [country, count] of counts) {
    if (count > bestCount) {
      best = country;
      bestCount = count;
    }
  }
  return best;
}

/** The New List Name SMS Edge proposes: the file name without extension, separators as spaces. */
export function defaultListName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base.length > 0 ? base.charAt(0).toUpperCase() + base.slice(1) : "";
}

export interface DetectedColumn {
  index: number;
  name: string;
  type: ColumnType;
}

export interface DetectedColumns {
  /** Whether the first row looked like a header rather than data. */
  hasHeader: boolean;
  columns: DetectedColumn[];
}

const PHONE_SHAPE = /^\+?[\d\s().-]{6,}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function looksLikePhone(value: string, defaultCountry: CountryCode | undefined): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (normalisePhone(trimmed, defaultCountry).ok) return true;
  return PHONE_SHAPE.test(trimmed) && trimmed.replace(/\D/g, "").length >= 7;
}

function share(values: readonly string[], predicate: (v: string) => boolean): number {
  const filled = values.filter((v) => v.trim().length > 0);
  if (filled.length === 0) return 0;
  return filled.filter(predicate).length / filled.length;
}

const HEADER_HINTS: ReadonlyArray<[RegExp, ColumnType]> = [
  [/^(phone|tel|mobile|msisdn|number|num|cell|movil|móvil|telefono|teléfono|gsm)/i, "phone"],
  [/^(name|full ?name)$/i, "first_name"],
  [/(first|given|nombre|prenom|prénom|vorname|imie|imię)/i, "first_name"],
  [/(last|sur|family|apellido|nom$|nachname|nazwisko)/i, "last_name"],
  [/(mail)/i, "email"],
  [/^(country|pais|país|pays|land|geo|iso)$/i, "country"],
  [/(birth|dob|^bday|nacimiento)/i, "date_of_birth"],
  [/^(gender|sex|sexo|genero|género)$/i, "gender"],
  [/^(state|province|provincia|region|región|county)$/i, "state"],
  [/(address|street|direccion|dirección|adresse)/i, "address"],
];

function typeFromHeader(header: string): ColumnType | undefined {
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  for (const [pattern, type] of HEADER_HINTS) {
    if (pattern.test(trimmed)) return type;
  }
  return undefined;
}

/**
 * Guess the type of each column of a parsed file from its header and the first rows.
 *
 * The phone column is the one where most values parse as phone numbers (against
 * `defaultCountry` for national formats). The first row is treated as a header unless its
 * phone cell is itself a phone number. Other columns are named from the header; unknown
 * ones become custom1..custom5 and anything beyond that is ignored.
 */
export function detectColumns(
  headerRow: readonly string[],
  sampleRows: ReadonlyArray<readonly string[]>,
  defaultCountry?: CountryCode,
): DetectedColumns {
  const width = Math.max(headerRow.length, ...sampleRows.map((r) => r.length), 1);
  const column = (i: number, rows: ReadonlyArray<readonly string[]>) => rows.map((r) => r[i] ?? "");
  const dataRows = sampleRows.length > 0 ? sampleRows : [headerRow];

  let phoneIndex = 0;
  let best = 0;
  for (let i = 0; i < width; i += 1) {
    const score = share(column(i, dataRows), (v) => looksLikePhone(v, defaultCountry));
    if (score > best) {
      best = score;
      phoneIndex = i;
    }
  }
  if (best < 0.5) {
    // Nothing parses: fall back to a header hint, else the first column.
    const hinted = headerRow.findIndex((h) => typeFromHeader(h) === "phone");
    phoneIndex = Math.max(hinted, 0);
  }

  const hasHeader = !looksLikePhone(headerRow[phoneIndex] ?? "", defaultCountry);
  const used = new Set<ColumnType>(["phone"]);
  const columns: DetectedColumn[] = [];
  let nextCustom = 1;

  for (let i = 0; i < width; i += 1) {
    const header = hasHeader ? (headerRow[i] ?? "").trim() : "";
    const name = header.length > 0 ? header : `Column ${i + 1}`;
    if (i === phoneIndex) {
      columns.push({ index: i, name, type: "phone" });
      continue;
    }
    let type: ColumnType | undefined = hasHeader ? typeFromHeader(header) : undefined;
    if (type === undefined || type === "phone" || used.has(type)) {
      const values = column(i, dataRows);
      type =
        share(values, (v) => EMAIL_SHAPE.test(v.trim())) >= 0.5
          ? "email"
          : share(values, (v) => parseCountryCell(v) !== undefined) >= 0.5
            ? "country"
            : undefined;
      if (type !== undefined && used.has(type)) type = undefined;
    }
    if (type === undefined) {
      type = nextCustom <= 5 ? (`custom${nextCustom}` as ColumnType) : "ignore";
      if (type !== "ignore") nextCustom += 1;
    }
    if (type !== "ignore") used.add(type);
    columns.push({ index: i, name, type });
  }
  return { hasHeader, columns };
}

export const DROP_REASONS = [
  "invalid",
  "damaged",
  "unparseable",
  "no_country",
  "landline",
  "premium",
  "toll_free",
  "voip",
] as const satisfies readonly DropReason[];

export type DropCounts = Record<DropReason, number>;

export function emptyDropCounts(): DropCounts {
  return {
    invalid: 0,
    damaged: 0,
    unparseable: 0,
    no_country: 0,
    landline: 0,
    premium: 0,
    toll_free: 0,
    voip: 0,
  };
}

export function countDrops(dropped: readonly DroppedNumber[]): DropCounts {
  const counts = emptyDropCounts();
  for (const d of dropped) counts[d.reason] += 1;
  return counts;
}

export const DROP_REASON_LABELS: Record<DropReason, string> = {
  invalid: "Invalid",
  damaged: "Damaged by a spreadsheet (like 4.9E+12)",
  unparseable: "Unparseable",
  no_country: "No country",
  landline: "Landline",
  premium: "Premium rate",
  toll_free: "Toll free",
  voip: "VoIP",
};

/** How many numbers of each kind the summary keeps as examples (the Files page lists them). */
export const SAMPLE_LIMIT = 50;

const samplesShape = {
  landline: z.array(z.string()).max(SAMPLE_LIMIT).default([]),
  suspicious: z.array(z.string()).max(SAMPLE_LIMIT).default([]),
  rejected: z.array(z.string()).max(SAMPLE_LIMIT).default([]),
  skipped: z.array(z.string()).max(SAMPLE_LIMIT).default([]),
  duplicates: z.array(z.string()).max(SAMPLE_LIMIT).default([]),
};

export interface UploadSamples {
  landline: string[];
  suspicious: string[];
  rejected: string[];
  skipped: string[];
  duplicates: string[];
}

export function emptySamples(): UploadSamples {
  return { landline: [], suspicious: [], rejected: [], skipped: [], duplicates: [] };
}

/** What one upload did, summed over its chunks. Stored with the import and shown to the user. */
export const UploadSummarySchema = z.object({
  rows: z.number().int().nonnegative(),
  /** Members added to the list, good and bad together. */
  imported: z.number().int().nonnegative(),
  skippedExisting: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  dropped: z.object({
    invalid: z.number().int().nonnegative(),
    /** Absent from summaries stored before 2026-11-12. */
    damaged: z.number().int().nonnegative().default(0),
    unparseable: z.number().int().nonnegative(),
    no_country: z.number().int().nonnegative(),
    landline: z.number().int().nonnegative(),
    premium: z.number().int().nonnegative(),
    toll_free: z.number().int().nonnegative(),
    voip: z.number().int().nonnegative(),
  }),
  /** Numbers kept but flagged Bad. */
  addedBad: z
    .object({
      landline: z.number().int().nonnegative().default(0),
      suspicious: z.number().int().nonnegative().default(0),
    })
    .default({ landline: 0, suspicious: 0 }),
  samples: z.object(samplesShape).default(emptySamples()),
});
export type UploadSummary = z.infer<typeof UploadSummarySchema>;

export function emptyUploadSummary(): UploadSummary {
  return {
    rows: 0,
    imported: 0,
    skippedExisting: 0,
    duplicates: 0,
    dropped: emptyDropCounts(),
    addedBad: { landline: 0, suspicious: 0 },
    samples: emptySamples(),
  };
}

function mergeSamples(a: UploadSamples, b: UploadSamples): UploadSamples {
  const out = emptySamples();
  for (const key of Object.keys(out) as (keyof UploadSamples)[]) {
    out[key] = [...a[key], ...b[key]].slice(0, SAMPLE_LIMIT);
  }
  return out;
}

export function addUploadSummary(a: UploadSummary, b: UploadSummary): UploadSummary {
  const dropped = emptyDropCounts();
  for (const reason of DROP_REASONS) dropped[reason] = a.dropped[reason] + b.dropped[reason];
  return {
    rows: a.rows + b.rows,
    imported: a.imported + b.imported,
    skippedExisting: a.skippedExisting + b.skippedExisting,
    duplicates: a.duplicates + b.duplicates,
    dropped,
    addedBad: {
      landline: a.addedBad.landline + b.addedBad.landline,
      suspicious: a.addedBad.suspicious + b.addedBad.suspicious,
    },
    samples: mergeSamples(a.samples, b.samples),
  };
}

/** Members added as good: imported minus the Bad ones. */
export function importedGood(summary: UploadSummary): number {
  return Math.max(0, summary.imported - summary.addedBad.landline - summary.addedBad.suspicious);
}

export function totalDropped(summary: UploadSummary): number {
  return DROP_REASONS.reduce((n, reason) => n + summary.dropped[reason], 0);
}

export const BAD_REASONS = ["landline", "suspicious"] as const;
export type BadReason = (typeof BAD_REASONS)[number];

export const BAD_REASON_LABELS: Record<BadReason, string> = {
  landline: "Not a mobile number (landline)",
  suspicious: "Suspicious digit pattern (likely fake)",
};

/** An upload row after cleaning: normalised number plus the contact fields that came with it. */
export interface CleanedRow extends Omit<UploadRow, "phone"> {
  e164: string;
  country: CountryCode;
  /** Set when the number is kept but flagged Bad (landline, suspicious pattern). */
  bad?: BadReason;
}

export interface CleanUploadRowsOptions {
  defaultCountry: CountryCode;
  removeLandlines: boolean;
  /**
   * SMS Edge semantics: landlines (when `removeLandlines`) and suspicious digit patterns are
   * kept and flagged Bad instead of dropped. Off, landlines are dropped as before.
   */
  keepBad?: boolean;
}

export interface CleanUploadRowsResult {
  kept: CleanedRow[];
  summary: UploadSummary;
}

/**
 * `cleanBatch` for upload rows: same normalisation, logical check and in-batch dedupe, but
 * each kept number keeps its contact fields. `summary.imported` and `skippedExisting` are
 * zero here; the import fills them in.
 */
export function cleanUploadRows(
  rows: readonly UploadRow[],
  opts: CleanUploadRowsOptions,
): CleanUploadRowsResult {
  const kept: CleanedRow[] = [];
  const dropped: DroppedNumber[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  const addedBad = { landline: 0, suspicious: 0 };
  const samples = emptySamples();
  const sample = (key: keyof UploadSamples, value: string) => {
    if (samples[key].length < SAMPLE_LIMIT) samples[key].push(value);
  };

  for (const { phone, country: countryCell, ...fields } of rows) {
    const rowCountry = countryCell ? parseCountryCell(countryCell) : undefined;
    const normalised = normalisePhone(phone, rowCountry ?? opts.defaultCountry);
    if (!normalised.ok) {
      dropped.push({ raw: phone, reason: normalised.reason });
      sample("rejected", phone);
      continue;
    }
    const check = logicalCheck(normalised, { removeLandlines: opts.removeLandlines });
    let bad: BadReason | undefined;
    if (!check.keep) {
      if (opts.keepBad && check.reason === "landline") {
        bad = "landline";
      } else {
        dropped.push({ raw: phone, reason: check.reason });
        sample("rejected", phone);
        continue;
      }
    } else if (opts.keepBad && isSuspiciousPattern(normalised.e164)) {
      bad = "suspicious";
    }
    if (seen.has(normalised.e164)) {
      duplicates += 1;
      sample("duplicates", normalised.e164);
      continue;
    }
    seen.add(normalised.e164);
    if (bad) {
      addedBad[bad] += 1;
      sample(bad, normalised.e164);
    }
    kept.push({
      ...fields,
      e164: normalised.e164,
      country: normalised.country,
      ...(bad ? { bad } : {}),
    });
  }

  return {
    kept,
    summary: {
      rows: rows.length,
      imported: 0,
      skippedExisting: 0,
      duplicates,
      dropped: countDrops(dropped),
      addedBad,
      samples,
    },
  };
}
