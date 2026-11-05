import {
  type CountryCode,
  type NumberType,
  parsePhoneNumberFromString,
} from "libphonenumber-js/max";

export type { CountryCode, NumberType };

export type NormaliseFailure = "invalid" | "unparseable" | "no_country";

export type NormaliseResult =
  | { ok: true; e164: string; country: CountryCode; type: NumberType }
  | { ok: false; reason: NormaliseFailure };

export type DropReason = NormaliseFailure | "landline" | "premium" | "toll_free" | "voip";

export type LogicalCheckResult = { keep: true } | { keep: false; reason: DropReason };

export interface LogicalCheckOptions {
  removeLandlines: boolean;
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
 */
export function normalisePhone(raw: string, defaultCountry?: CountryCode): NormaliseResult {
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
    if (national?.ok === true) {
      return national;
    }
    // Not a valid national number: perhaps it is an international one missing its plus sign.
    const international = classify(`+${compact}`, defaultCountry);
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
