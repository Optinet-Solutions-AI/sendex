import { z } from "zod";
import { flagEmoji } from "./campaigns.js";

export { flagEmoji };

import {
  type CountryCode,
  type DroppedNumber,
  type DropReason,
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

export const COLUMN_TYPES = [
  "phone",
  "first_name",
  "last_name",
  "email",
  "custom1",
  "custom2",
  "custom3",
  "custom4",
  "custom5",
  "ignore",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export const ColumnTypeSchema = z.enum(COLUMN_TYPES);

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  phone: "Phone",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  custom1: "Custom 1",
  custom2: "Custom 2",
  custom3: "Custom 3",
  custom4: "Custom 4",
  custom5: "Custom 5",
  ignore: "Ignore",
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
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
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
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
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
      type =
        share(column(i, dataRows), (v) => EMAIL_SHAPE.test(v.trim())) >= 0.5 ? "email" : undefined;
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
  unparseable: "Unparseable",
  no_country: "No country",
  landline: "Landline",
  premium: "Premium rate",
  toll_free: "Toll free",
  voip: "VoIP",
};

/** What one upload did, summed over its chunks. Stored in the audit log and shown to the user. */
export const UploadSummarySchema = z.object({
  rows: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  skippedExisting: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  dropped: z.object({
    invalid: z.number().int().nonnegative(),
    unparseable: z.number().int().nonnegative(),
    no_country: z.number().int().nonnegative(),
    landline: z.number().int().nonnegative(),
    premium: z.number().int().nonnegative(),
    toll_free: z.number().int().nonnegative(),
    voip: z.number().int().nonnegative(),
  }),
});
export type UploadSummary = z.infer<typeof UploadSummarySchema>;

export function emptyUploadSummary(): UploadSummary {
  return { rows: 0, imported: 0, skippedExisting: 0, duplicates: 0, dropped: emptyDropCounts() };
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
  };
}

export function totalDropped(summary: UploadSummary): number {
  return DROP_REASONS.reduce((n, reason) => n + summary.dropped[reason], 0);
}

/** An upload row after cleaning: normalised number plus the contact fields that came with it. */
export interface CleanedRow extends Omit<UploadRow, "phone"> {
  e164: string;
  country: CountryCode;
}

export interface CleanUploadRowsOptions {
  defaultCountry: CountryCode;
  removeLandlines: boolean;
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

  for (const { phone, ...fields } of rows) {
    const normalised = normalisePhone(phone, opts.defaultCountry);
    if (!normalised.ok) {
      dropped.push({ raw: phone, reason: normalised.reason });
      continue;
    }
    const check = logicalCheck(normalised, { removeLandlines: opts.removeLandlines });
    if (!check.keep) {
      dropped.push({ raw: phone, reason: check.reason });
      continue;
    }
    if (seen.has(normalised.e164)) {
      duplicates += 1;
      continue;
    }
    seen.add(normalised.e164);
    kept.push({ ...fields, e164: normalised.e164, country: normalised.country });
  }

  return {
    kept,
    summary: {
      rows: rows.length,
      imported: 0,
      skippedExisting: 0,
      duplicates,
      dropped: countDrops(dropped),
    },
  };
}
