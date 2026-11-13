import {
  type CountryCode,
  type NumberType,
  parsePhoneNumberFromString,
} from "libphonenumber-js/max";

export type { CountryCode, NumberType };

export type NormaliseFailure = "invalid" | "unparseable" | "no_country" | "damaged";

export type NormaliseResult =
  | { ok: true; e164: string; country: CountryCode; type: NumberType }
  | { ok: false; reason: NormaliseFailure };

export type DropReason = NormaliseFailure | "landline" | "premium" | "toll_free" | "voip";

export type LogicalCheckResult = { keep: true } | { keep: false; reason: DropReason };

export interface LogicalCheckOptions {
  removeLandlines: boolean;
}

/**
 * A phone number a spreadsheet program has cut short: `4.91516E+12` is what Excel writes for
 * 4915161234567 when it re-saves a CSV. The missing digits are gone, so the cell cannot be
 * read as a number; stripping it to its digits would invent a different, wrong one.
 */
export function isSpreadsheetDamaged(raw: string): boolean {
  return /^\s*\d+(?:[.,]\d+)?\s*e\s*\+?\s*\d+\s*$/i.test(raw);
}

/** How many cells of a column are {@link isSpreadsheetDamaged}; the upload form warns with it. */
export function countSpreadsheetDamaged(values: readonly string[]): number {
  let count = 0;
  for (const value of values) if (isSpreadsheetDamaged(value)) count += 1;
  return count;
}

/** Number types an SMS can be sent to as a mobile. */
function isMobileType(type: NumberType): boolean {
  return type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE";
}

/** Strip everything that is not a digit or a leading plus sign. */
function digitsOnly(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/\D/g, "");
}

function classify(e164: string, defaultCountry?: CountryCode): NormaliseResult | undefined {
  const parsed = parsePhoneNumberFromString(e164, defaultCountry);
  if (parsed === undefined) {
    return undefined;
  }
  if (!parsed.isValid()) {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.country === undefined) {
    // Non-geographic (+800, +870, …): valid, but no country to route it under.
    return { ok: false, reason: "no_country" };
  }
  return { ok: true, e164: parsed.number, country: parsed.country, type: parsed.getType() };
}

/**
 * Normalise a raw phone number to E.164 and classify it.
 *
 * Accepts `+`, a leading `00` or a bare country code, with any mix of spaces, dots, dashes and
 * parentheses. A number without a country code is parsed against `defaultCountry`; without
 * one it is reported as `no_country`.
 *
 * A number without a plus can often be read two ways: as a local number of `defaultCountry`,
 * or as an international one whose plus is missing (`4915123456789`, the way SMS Edge exports
 * write them). Loose numbering plans (Germany, Austria) accept the first reading of almost
 * anything as a landline, so when both readings are valid the mobile one wins, and when
 * neither or both are mobile the international one wins if it is in `defaultCountry`.
 *
 * Scientific notation (`4.91516E+12`) is reported as `damaged`, never read.
 */
export function normalisePhone(raw: string, defaultCountry?: CountryCode): NormaliseResult {
  if (isSpreadsheetDamaged(raw)) {
    return { ok: false, reason: "damaged" };
  }
  const compact = digitsOnly(raw);
  if (compact.replace("+", "").length === 0) {
    return { ok: false, reason: "unparseable" };
  }

  if (compact.startsWith("+")) {
    return classify(compact, defaultCountry) ?? { ok: false, reason: "unparseable" };
  }
  if (compact.startsWith("00")) {
    return classify(`+${compact.slice(2)}`, defaultCountry) ?? { ok: false, reason: "unparseable" };
  }

  if (defaultCountry !== undefined) {
    const national = classify(compact, defaultCountry);
    const international = classify(`+${compact}`, defaultCountry);
    if (national?.ok === true && international?.ok === true) {
      const nationalMobile = isMobileType(national.type);
      const internationalMobile = isMobileType(international.type);
      if (internationalMobile !== nationalMobile) {
        return internationalMobile ? international : national;
      }
      return international.country === defaultCountry ? international : national;
    }
    if (national?.ok === true) {
      return national;
    }
    // Not a valid national number: perhaps it is an international one missing its plus sign.
    if (international?.ok === true) {
      return international;
    }
    return national ?? international ?? { ok: false, reason: "unparseable" };
  }

  // No country code and no default: the only hope is that it is international without a plus.
  const international = classify(`+${compact}`);
  if (international?.ok === true) {
    return international;
  }
  return { ok: false, reason: "no_country" };
}

/**
 * Decide whether a normalised number should be kept in a marketing list.
 *
 * Mobiles, numbers that may be mobiles and valid numbers of unknown type are kept. VoIP is
 * kept because some carriers deliver to it. Landlines are dropped only when asked. Premium,
 * toll free and shared-cost numbers are never kept; pagers, UANs, personal numbers and
 * voicemail are not reachable by SMS and are dropped as invalid.
 */
export function logicalCheck(
  result: NormaliseResult,
  opts: LogicalCheckOptions,
): LogicalCheckResult {
  if (!result.ok) {
    return { keep: false, reason: result.reason };
  }
  switch (result.type) {
    case "MOBILE":
    case "FIXED_LINE_OR_MOBILE":
    case "VOIP":
    case undefined:
      return { keep: true };
    case "FIXED_LINE":
      return opts.removeLandlines ? { keep: false, reason: "landline" } : { keep: true };
    case "PREMIUM_RATE":
    case "SHARED_COST":
      return { keep: false, reason: "premium" };
    case "TOLL_FREE":
      return { keep: false, reason: "toll_free" };
    case "PAGER":
    case "UAN":
    case "PERSONAL_NUMBER":
    case "VOICEMAIL":
      return { keep: false, reason: "invalid" };
  }
}

export interface CleanBatchOptions {
  defaultCountry?: CountryCode;
  removeLandlines: boolean;
  dedupe: boolean;
}

export interface KeptNumber {
  e164: string;
  country: CountryCode;
}

export interface DroppedNumber {
  raw: string;
  reason: DropReason;
}

export interface CleanBatchResult {
  kept: KeptNumber[];
  dropped: DroppedNumber[];
  duplicates: number;
}

/**
 * Normalise and check a batch of raw rows. Plain loop so it copes with large uploads.
 * With `dedupe`, repeats of the same E.164 number within the batch are counted, not kept.
 */
export function cleanBatch(rows: readonly string[], opts: CleanBatchOptions): CleanBatchResult {
  const kept: KeptNumber[] = [];
  const dropped: DroppedNumber[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const raw of rows) {
    const normalised = normalisePhone(raw, opts.defaultCountry);
    if (!normalised.ok) {
      dropped.push({ raw, reason: normalised.reason });
      continue;
    }
    const check = logicalCheck(normalised, { removeLandlines: opts.removeLandlines });
    if (!check.keep) {
      dropped.push({ raw, reason: check.reason });
      continue;
    }
    if (opts.dedupe) {
      if (seen.has(normalised.e164)) {
        duplicates += 1;
        continue;
      }
      seen.add(normalised.e164);
    }
    kept.push({ e164: normalised.e164, country: normalised.country });
  }

  return { kept, dropped, duplicates };
}

/**
 * Numbers that parse but are almost surely fake: six or more of the same digit in a row,
 * a straight run of seven digits (1234567, 7654321) or five or more trailing zeros, judged
 * on the national part (the last nine digits). SMS Edge calls these "Not Logical".
 */
export function isSuspiciousPattern(e164: string): boolean {
  const digits = e164.replace(/\D/g, "");
  const national = digits.slice(Math.max(0, digits.length - 9));
  if (/(\d)\1{5,}/.test(national)) return true;
  if (/0{5,}$/.test(national)) return true;
  for (const run of ["0123456789", "9876543210"]) {
    for (let i = 0; i + 7 <= run.length; i += 1) {
      if (national.includes(run.slice(i, i + 7))) return true;
    }
  }
  return false;
}
