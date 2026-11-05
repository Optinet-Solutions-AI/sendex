/**
 * SMS text analysis: GSM 03.38 (7-bit) vs UCS-2 detection, character counting
 * and part splitting, matching what carriers (and the SMS Edge editor) report.
 */

export type SmsEncoding = "GSM_7BIT" | "UCS2";

export interface SmsTextAnalysis {
  encoding: SmsEncoding;
  /** Billable characters: GSM extension characters count as 2. */
  chars: number;
  parts: number;
  /** Characters left before another part is needed. */
  left: number;
}

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENSION = "\f^{}\\[~]|€";

const BASIC = new Set(GSM_BASIC);
const EXT = new Set(GSM_EXTENSION);

export const GSM_SINGLE_LIMIT = 160;
export const GSM_MULTI_LIMIT = 153;
export const UCS2_SINGLE_LIMIT = 70;
export const UCS2_MULTI_LIMIT = 67;

export function detectEncoding(text: string): SmsEncoding {
  for (const ch of text) {
    if (!BASIC.has(ch) && !EXT.has(ch)) return "UCS2";
  }
  return "GSM_7BIT";
}

function gsmLength(text: string): number {
  let n = 0;
  for (const ch of text) n += EXT.has(ch) ? 2 : 1;
  return n;
}

function ucs2Length(text: string): number {
  // UCS-2 counts UTF-16 code units; astral characters (emoji) take two.
  return text.length;
}

export function analyseSmsText(text: string): SmsTextAnalysis {
  const encoding = detectEncoding(text);
  const chars = encoding === "GSM_7BIT" ? gsmLength(text) : ucs2Length(text);
  const single = encoding === "GSM_7BIT" ? GSM_SINGLE_LIMIT : UCS2_SINGLE_LIMIT;
  const multi = encoding === "GSM_7BIT" ? GSM_MULTI_LIMIT : UCS2_MULTI_LIMIT;
  if (chars <= single) {
    return { encoding, chars, parts: 1, left: single - chars };
  }
  const parts = Math.ceil(chars / multi);
  return { encoding, chars, parts, left: parts * multi - chars };
}
