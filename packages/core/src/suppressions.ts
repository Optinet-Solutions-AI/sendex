import { normalisePhone } from "./phone.js";

/**
 * Unsubscribe (suppression) helpers: how a number typed, pasted, uploaded or sent by the
 * Unsubscribe API becomes the E.164 the send loop checks, and the two URLs of the
 * Unsubscribe API tab.
 */

export const SUPPRESSION_SOURCES = ["manual", "upload", "api", "sms"] as const;
export type SuppressionSource = (typeof SUPPRESSION_SOURCES)[number];

export interface SuppressionNumber {
  e164: string;
  country: string;
}

/**
 * International format, ignoring spaces, dashes, dots, parentheses and a leading `+` or
 * `00`. No default country: a national number cannot be unsubscribed account-wide
 * because the account spans countries. Null when it does not parse.
 */
export function normaliseSuppressionNumber(raw: string): SuppressionNumber | null {
  const compact = raw.trim();
  if (compact === "") return null;
  const digits = compact.replace(/[^\d+]/g, "");
  const candidate = digits.startsWith("+") ? digits : `+${digits.replace(/^00/, "")}`;
  const parsed = normalisePhone(candidate);
  if (!parsed.ok) return null;
  return { e164: parsed.e164, country: parsed.country };
}

/** Normalise a batch, keeping the first of every repeated number; returns what was rejected too. */
export function normaliseSuppressionBatch(raws: readonly string[]): {
  numbers: SuppressionNumber[];
  rejected: string[];
} {
  const seen = new Set<string>();
  const numbers: SuppressionNumber[] = [];
  const rejected: string[] = [];
  for (const raw of raws) {
    const parsed = normaliseSuppressionNumber(raw);
    if (!parsed) {
      if (raw.trim() !== "") rejected.push(raw.trim());
      continue;
    }
    if (seen.has(parsed.e164)) continue;
    seen.add(parsed.e164);
    numbers.push(parsed);
  }
  return { numbers, rejected };
}

/** The two Unsubscribe API URLs, with the triple-brace placeholders of the spec. */
export function unsubscribeUrls(
  base: string,
  orgKey: string,
): { byDynamic: string; byNumber: string } {
  const root = `${base.replace(/\/+$/, "")}/unsubscribe/${encodeURIComponent(orgKey)}`;
  return {
    byDynamic: `${root}?type=rm-fk&fk={{{dynamic}}}`,
    byNumber: `${root}?type=rm-u&number={{{number}}}`,
  };
}
