import { z } from "zod";

/**
 * Brand deals (D5-16): what a brand pays us, read from the Media Deals export. Revenue in
 * Sendex is the CPA of the offer's brand deal for each first deposit; the amount a tracker
 * sends with a deposit postback is not revenue.
 *
 * Only a CPA in euros becomes a price. Revshare and base are left out (they are not paid per
 * deposit), and a deal written in another currency, without a currency, with more than one
 * CPA, or as free text has no price: it is listed so someone can see why.
 */

export type DealPrice = { cpaMicro: bigint } | { cpaMicro: null; reason: string };

const MICRO = 1_000_000;

const CURRENCY = String.raw`(€|eur|euro|euros|\$|usd|£|gbp|cad|c\$|aud|a\$|nzd|chf|sek|nok|pln)`;
const AMOUNT = String.raw`(\d{1,3}(?:[.,]\d{3})+(?![\d])|\d+(?:[.,]\d{1,2})?)`;

/** `€200 CPA`, `EUR 200 CPA`, `200€ CPA`, `200 EUR CPA`, `CPA €200`, and `200 CPA` (no currency). */
const CPA_PATTERNS: readonly { re: RegExp; currency: number; amount: number }[] = [
  { re: new RegExp(`${CURRENCY}\\s*${AMOUNT}\\s*cpa\\b`, "gi"), currency: 1, amount: 2 },
  { re: new RegExp(`${AMOUNT}\\s*${CURRENCY}\\s*cpa\\b`, "gi"), currency: 2, amount: 1 },
  { re: new RegExp(`\\bcpa\\s*[:-]?\\s*${CURRENCY}\\s*${AMOUNT}`, "gi"), currency: 1, amount: 2 },
  { re: new RegExp(`\\bcpa\\s*[:-]?\\s*${AMOUNT}\\s*${CURRENCY}`, "gi"), currency: 2, amount: 1 },
];
const BARE_CPA = new RegExp(`${AMOUNT}\\s*cpa\\b`, "i");

function amountMicro(text: string): bigint {
  // "1,000" / "1.000" are thousands; "120.50" / "120,5" are decimals.
  const plain = /^\d{1,3}(?:[.,]\d{3})+$/.test(text) ? text.replace(/[.,]/g, "") : text;
  return BigInt(Math.round(Number(plain.replace(",", ".")) * MICRO));
}

/** The euro CPA in a Media Deals deal text such as "€200 CPA + 40% rev + €20 base". */
export function cpaFromDeal(text: string): DealPrice {
  const found: { currency: string; micro: bigint; at: number }[] = [];
  for (const pattern of CPA_PATTERNS) {
    for (const m of text.matchAll(pattern.re)) {
      const at = m.index ?? 0;
      if (found.some((f) => f.at === at)) continue;
      found.push({
        currency: (m[pattern.currency] ?? "").toLowerCase(),
        micro: amountMicro(m[pattern.amount] ?? "0"),
        at,
      });
    }
  }
  if (found.length === 0) {
    return BARE_CPA.test(text)
      ? { cpaMicro: null, reason: "No currency on the CPA" }
      : { cpaMicro: null, reason: "No CPA in the deal" };
  }
  if (found.length > 1) return { cpaMicro: null, reason: "More than one CPA in the deal" };
  const [cpa] = found;
  if (!cpa || !["€", "eur", "euro", "euros"].includes(cpa.currency)) {
    return { cpaMicro: null, reason: "CPA not in euros" };
  }
  return { cpaMicro: cpa.micro };
}

function normalise(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** One deal per affiliate program and brand: the same brand can come through two programs. */
export function dealKey(program: string, brand: string): string {
  return `${normalise(program)}|${normalise(brand)}`;
}

export interface SheetDeal {
  key: string;
  program: string;
  brand: string;
  /** The deal as written in Media Deals. */
  deal: string;
  topGeos: string;
  /** YYYY-MM-DD from the sheet's date column; null means the day chosen at upload. */
  startsOn: string | null;
  /** Micro-EUR paid per first deposit, or null with the reason. */
  cpaMicro: bigint | null;
  reason: string | null;
}

export type DealSheetResult =
  | { ok: true; deals: SheetDeal[]; problems: string[] }
  | { ok: false; error: string };

/**
 * Header names, matched case-insensitively. Only these columns are read: Media Deals' export
 * also carries contacts and logins (Contact, Telegram, Skype, User Name, PASS, Email), which
 * Sendex never reads or stores.
 */
const COLUMNS = {
  program: ["affiliate program name", "affiliate program", "program"],
  brand: ["all brands", "brands", "brand", "brand name"],
  deal: ["deal", "commercial deal", "deals"],
  topGeos: ["top geos", "geos", "top geo"],
  date: ["start date", "date", "valid from", "from", "deal date", "effective date"],
} as const;

const NO_COLUMNS = 'No "ALL BRANDS" and "Deal" columns found. Upload the Media Deals export.';

function columnIndex(header: readonly string[], names: readonly string[]): number {
  const cells = header.map(normalise);
  for (const name of names) {
    const i = cells.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

/** YYYY-MM-DD from YYYY-MM-DD, DD/MM/YYYY or DD.MM.YYYY (and D/M/YYYY), else null. */
function readDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const parts = iso
    ? { y: iso[1], m: iso[2], d: iso[3] }
    : dmy
      ? { y: dmy[3], m: dmy[2], d: dmy[1] }
      : null;
  if (!parts) return null;
  const y = Number(parts.y);
  const m = Number(parts.m);
  const d = Number(parts.d);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

type Column = keyof typeof COLUMNS;

/** The header row (among the first ten) with a brand and a deal column, and where each column is. */
function findHeader(
  rows: readonly (readonly string[])[],
): { headerAt: number; col: Record<Column, number> } | null {
  const headerAt = rows
    .slice(0, 10)
    .findIndex((r) => columnIndex(r, COLUMNS.brand) >= 0 && columnIndex(r, COLUMNS.deal) >= 0);
  const header = rows[headerAt];
  if (headerAt < 0 || !header) return null;
  return {
    headerAt,
    col: {
      program: columnIndex(header, COLUMNS.program),
      brand: columnIndex(header, COLUMNS.brand),
      deal: columnIndex(header, COLUMNS.deal),
      topGeos: columnIndex(header, COLUMNS.topGeos),
      date: columnIndex(header, COLUMNS.date),
    },
  };
}

/**
 * The header and rows cut down to the columns Sendex reads (program, brands, deal, top geos,
 * date), in the file's order. The upload page runs this in the browser, so the export's
 * contacts and logins are never sent. Null when there is no brand and deal header.
 */
export function dealSheetColumns(rows: readonly (readonly string[])[]): string[][] | null {
  const found = findHeader(rows);
  if (!found) return null;
  const keep = Object.values(found.col)
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  return rows.slice(found.headerAt).map((r) => keep.map((i) => r[i] ?? ""));
}

/**
 * The deals in a Media Deals export (CSV or Excel rows as text). The header is the first row,
 * among the first ten, with a brand and a deal column. Each brand in the brands cell (split
 * on "|" and new lines) becomes its own deal with the row's deal text.
 */
export function parseDealSheet(rows: readonly (readonly string[])[]): DealSheetResult {
  const found = findHeader(rows);
  if (!found) return { ok: false, error: NO_COLUMNS };
  const { headerAt, col } = found;
  const cell = (r: readonly string[], i: number) => (i < 0 ? "" : (r[i] ?? "").trim());

  const deals: SheetDeal[] = [];
  const problems: string[] = [];
  rows.slice(headerAt + 1).forEach((r, offset) => {
    const brands = cell(r, col.brand)
      .split(/\s*\|\s*|\r?\n/)
      .map((b) => b.trim())
      .filter((b) => b !== "");
    if (brands.length === 0) return;
    const dateText = cell(r, col.date);
    const startsOn = dateText === "" ? null : readDate(dateText);
    if (dateText !== "" && startsOn === null) {
      problems.push(
        `Row ${headerAt + offset + 2}: the date "${dateText}" is not a date (use YYYY-MM-DD)`,
      );
      return;
    }
    const program = cell(r, col.program);
    const deal = cell(r, col.deal);
    const price = cpaFromDeal(deal);
    for (const brand of brands) {
      deals.push({
        key: dealKey(program, brand),
        program,
        brand,
        deal,
        topGeos: cell(r, col.topGeos),
        startsOn,
        cpaMicro: price.cpaMicro,
        reason: price.cpaMicro === null ? price.reason : null,
      });
    }
  });
  return { ok: true, deals, problems };
}

/**
 * The deal whose brand appears, as whole words, in the offer's name ("Alpha Casino UK" →
 * Alpha Casino); the longest brand wins. Null when none does.
 */
export function suggestDealForOffer(
  offerName: string,
  deals: readonly { key: string; brand: string }[],
): string | null {
  const words = ` ${offerName.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  let best: { key: string; length: number } | null = null;
  for (const deal of deals) {
    const brand = deal.brand
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (brand.length < 3 || !words.includes(` ${brand} `)) continue;
    if (!best || brand.length > best.length) best = { key: deal.key, length: brand.length };
  }
  return best?.key ?? null;
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** The upload form: the file's rows as text and the day its prices apply from. */
export const uploadDealsSchema = z.object({
  startsOn: isoDay,
  fileName: z.string().trim().max(200),
  rows: z.array(z.array(z.string().max(5000)).max(100)).max(5000),
});
export type UploadDealsInput = z.infer<typeof uploadDealsSchema>;

/** Which brand deal an offer earns from; null for none. */
export const setOfferDealSchema = z.object({
  linkId: z.uuid(),
  dealKey: z.string().min(1).max(500).nullable(),
});
export type SetOfferDealInput = z.infer<typeof setOfferDealSchema>;

/**
 * The Scaleo offer an offer link points to (D5-23): the `o` parameter of a Scaleo click link,
 * e.g. `…/click?o=1234&a=42&sub_id1=…` → 1234. Null for any other link.
 */
export function scaleoOfferIdFromUrl(url: string): number | null {
  const match = /[?&]o=(\d{1,9})(?:&|$)/.exec(url);
  return match?.[1] ? Number(match[1]) : null;
}

/** A deal kept per Scaleo offer: every Sendex offer linking to that offer earns it. */
export function scaleoDealKey(scaleoOfferId: number): string {
  return `scaleo:${scaleoOfferId}`;
}

const optionalOfferId = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v : v.trim() === "" ? null : Number(v.trim())))
  .pipe(z.number().int().positive().nullable());

/**
 * A deal typed in Sendex (D5-23): the brand's program, the brand, the Scaleo offer it is sold
 * through (optional), what it pays per first deposit in euros, and the day it starts.
 */
export const addDealSchema = z.object({
  program: z.string().trim().min(1, "Program is required").max(120),
  brand: z.string().trim().min(1, "Brand is required").max(120),
  scaleoOfferId: optionalOfferId,
  cpaEur: z.coerce.number().positive("The CPA must be more than €0").max(100_000),
  startsOn: isoDay,
});
export type AddDealInput = z.infer<typeof addDealSchema>;

/** The stored deal for a typed one: keyed by its Scaleo offer when it has one. */
export function dealFromForm(input: AddDealInput): SheetDeal {
  const cpaMicro = BigInt(Math.round(input.cpaEur * MICRO));
  const euros = Number.isInteger(input.cpaEur) ? String(input.cpaEur) : input.cpaEur.toFixed(2);
  return {
    key:
      input.scaleoOfferId === null
        ? dealKey(input.program, input.brand)
        : scaleoDealKey(input.scaleoOfferId),
    program: input.program,
    brand: input.brand,
    deal:
      input.scaleoOfferId === null
        ? `€${euros} CPA`
        : `€${euros} CPA (Scaleo offer ${input.scaleoOfferId})`,
    topGeos: "",
    startsOn: input.startsOn,
    cpaMicro,
    reason: null,
  };
}
