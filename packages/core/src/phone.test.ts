import { describe, expect, it } from "vitest";
import {
  cleanBatch,
  countSpreadsheetDamaged,
  isSpreadsheetDamaged,
  isSuspiciousPattern,
  logicalCheck,
  normalisePhone,
} from "./phone.js";

describe("normalisePhone", () => {
  it("parses an E.164 number as-is", () => {
    expect(normalisePhone("+34612345678")).toEqual({
      ok: true,
      e164: "+34612345678",
      country: "ES",
      type: "MOBILE",
    });
  });

  it("tolerates spaces, dots, dashes and parentheses", () => {
    expect(normalisePhone("+34 612 345 678")).toMatchObject({ ok: true, e164: "+34612345678" });
    expect(normalisePhone("+34 (612) 345-678")).toMatchObject({ ok: true, e164: "+34612345678" });
    expect(normalisePhone("+34 612.345.678")).toMatchObject({ ok: true, e164: "+34612345678" });
    expect(normalisePhone("  +34612345678 ")).toMatchObject({ ok: true, e164: "+34612345678" });
  });

  it("accepts the international 00 prefix without a default country", () => {
    expect(normalisePhone("0034612345678")).toMatchObject({ ok: true, e164: "+34612345678" });
    expect(normalisePhone("0044 7400 123456")).toMatchObject({
      ok: true,
      e164: "+447400123456",
      country: "GB",
    });
  });

  it("accepts a country code without a plus sign", () => {
    expect(normalisePhone("34612345678")).toMatchObject({ ok: true, e164: "+34612345678" });
    expect(normalisePhone("34 612 345 678")).toMatchObject({ ok: true, e164: "+34612345678" });
  });

  it("uses the default country for national numbers", () => {
    expect(normalisePhone("612345678", "ES")).toMatchObject({ ok: true, e164: "+34612345678" });
    expect(normalisePhone("06 12 34 56 78", "FR")).toMatchObject({
      ok: true,
      e164: "+33612345678",
      type: "MOBILE",
    });
    expect(normalisePhone("07400 123456", "GB")).toMatchObject({ ok: true, e164: "+447400123456" });
    expect(normalisePhone("(030) 1234 5678", "DE")).toMatchObject({
      ok: true,
      e164: "+493012345678",
      type: "FIXED_LINE",
    });
    expect(normalisePhone("0412 345 678", "AU")).toMatchObject({ ok: true, e164: "+61412345678" });
  });

  it("lets an explicit country code override the default country", () => {
    expect(normalisePhone("+34612345678", "FR")).toMatchObject({ ok: true, country: "ES" });
    expect(normalisePhone("0034 612 345 678", "FR")).toMatchObject({ ok: true, country: "ES" });
    // A bare country code is still recognised when it does not form a valid national number.
    expect(normalisePhone("34612345678", "ES")).toMatchObject({ ok: true, e164: "+34612345678" });
  });

  it("reports no_country when a national number arrives without a default country", () => {
    expect(normalisePhone("612345678")).toEqual({ ok: false, reason: "no_country" });
    expect(normalisePhone("0612345678")).toEqual({ ok: false, reason: "no_country" });
  });

  it("reports no_country for non-geographic numbers (+800 international toll free)", () => {
    expect(normalisePhone("+800 1234 5678")).toEqual({ ok: false, reason: "no_country" });
  });

  it("reports unparseable for garbage and empty input", () => {
    expect(normalisePhone("abc")).toEqual({ ok: false, reason: "unparseable" });
    expect(normalisePhone("")).toEqual({ ok: false, reason: "unparseable" });
    expect(normalisePhone("+", "ES")).toEqual({ ok: false, reason: "unparseable" });
    expect(normalisePhone("---")).toEqual({ ok: false, reason: "unparseable" });
  });

  it("reports no_country rather than guessing for short digit strings", () => {
    // Without a plus, 00 or default country there is nothing to say which plan "12345" is in.
    expect(normalisePhone("12345")).toEqual({ ok: false, reason: "no_country" });
  });

  it("reports invalid for numbers that parse but do not match the numbering plan", () => {
    expect(normalisePhone("+34 6123")).toEqual({ ok: false, reason: "invalid" });
    // 07 12 is not an allocated French mobile block (07 30+ is); libphonenumber says invalid.
    expect(normalisePhone("+33712345678")).toEqual({ ok: false, reason: "invalid" });
    // Ofcom reserves 07700 900xxx for drama use; it is not an allocated range.
    expect(normalisePhone("+44 7700 900123")).toEqual({ ok: false, reason: "invalid" });
  });
});

type Expected = {
  raw: string;
  country: string;
  type: string | undefined;
  withLandlines: boolean;
  withoutLandlines: boolean;
  reason?: string;
};

/**
 * Known outcomes per country. The `type` column is what libphonenumber's `max` metadata
 * reports; where that differed from the naive expectation the fixture was adjusted and the
 * reason noted inline.
 */
const fixtures: Expected[] = [
  // Spain: 6xx/7xx mobile, 9xx/8xx landline, 900 toll free, 803/806/807 premium
  {
    raw: "+34612345678",
    country: "ES",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+34600000000",
    country: "ES",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+34912345678",
    country: "ES",
    type: "FIXED_LINE",
    withLandlines: true,
    withoutLandlines: false,
    reason: "landline",
  },
  {
    raw: "+34900123456",
    country: "ES",
    type: "TOLL_FREE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "toll_free",
  },
  {
    raw: "+34803123456",
    country: "ES",
    type: "PREMIUM_RATE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "premium",
  },
  // France: 06/07 mobile, 01-05 landline, 0800 toll free, 089x premium
  {
    raw: "+33612345678",
    country: "FR",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+33734567890",
    country: "FR",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+33123456789",
    country: "FR",
    type: "FIXED_LINE",
    withLandlines: true,
    withoutLandlines: false,
    reason: "landline",
  },
  {
    raw: "+33800123456",
    country: "FR",
    type: "TOLL_FREE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "toll_free",
  },
  {
    raw: "+33899123456",
    country: "FR",
    type: "PREMIUM_RATE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "premium",
  },
  // United Kingdom: 07 mobile, 020 landline, 0800 toll free, 09 premium, 03 UAN, 056 VoIP
  {
    raw: "+447400123456",
    country: "GB",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+447912345678",
    country: "GB",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  // 07911 is allocated to Guernsey (Sure), so libphonenumber reports GG rather than GB.
  {
    raw: "+447911123456",
    country: "GG",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+442071234567",
    country: "GB",
    type: "FIXED_LINE",
    withLandlines: true,
    withoutLandlines: false,
    reason: "landline",
  },
  {
    raw: "+448001111111",
    country: "GB",
    type: "TOLL_FREE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "toll_free",
  },
  {
    raw: "+449091234567",
    country: "GB",
    type: "PREMIUM_RATE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "premium",
  },
  {
    raw: "+443001234567",
    country: "GB",
    type: "UAN",
    withLandlines: false,
    withoutLandlines: false,
    reason: "invalid",
  },
  {
    raw: "+445600000000",
    country: "GB",
    type: "VOIP",
    withLandlines: true,
    withoutLandlines: true,
  },
  // Germany: 015/016/017 mobile, 030 landline, 0800 toll free, 0900 premium
  {
    raw: "+4915112345678",
    country: "DE",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+4916012345678",
    country: "DE",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+4917012345678",
    country: "DE",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+493012345678",
    country: "DE",
    type: "FIXED_LINE",
    withLandlines: true,
    withoutLandlines: false,
    reason: "landline",
  },
  {
    raw: "+498001234567",
    country: "DE",
    type: "TOLL_FREE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "toll_free",
  },
  {
    raw: "+499001234567",
    country: "DE",
    type: "PREMIUM_RATE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "premium",
  },
  // Poland: 5xx/6xx/7xx/8xx mobile, 22 Warsaw landline
  {
    raw: "+48512345678",
    country: "PL",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+48601234567",
    country: "PL",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+48721234567",
    country: "PL",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+48881234567",
    country: "PL",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+48221234567",
    country: "PL",
    type: "FIXED_LINE",
    withLandlines: true,
    withoutLandlines: false,
    reason: "landline",
  },
  // Finland: 04x/05x mobile, 09 Helsinki landline
  {
    raw: "+358401234567",
    country: "FI",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+358501234567",
    country: "FI",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+358912345678",
    country: "FI",
    type: "FIXED_LINE",
    withLandlines: true,
    withoutLandlines: false,
    reason: "landline",
  },
  // New Zealand: 02x mobile, 09 Auckland landline, 0800 toll free
  {
    raw: "+64211234567",
    country: "NZ",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+6494123456",
    country: "NZ",
    type: "FIXED_LINE",
    withLandlines: true,
    withoutLandlines: false,
    reason: "landline",
  },
  {
    raw: "+64800123456",
    country: "NZ",
    type: "TOLL_FREE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "toll_free",
  },
  // Australia: 04 mobile, 02 Sydney landline
  {
    raw: "+61412345678",
    country: "AU",
    type: "MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+61212345678",
    country: "AU",
    type: "FIXED_LINE",
    withLandlines: true,
    withoutLandlines: false,
    reason: "landline",
  },
  // United States: NANP numbers cannot be told apart, so they are FIXED_LINE_OR_MOBILE and kept
  {
    raw: "+12025550123",
    country: "US",
    type: "FIXED_LINE_OR_MOBILE",
    withLandlines: true,
    withoutLandlines: true,
  },
  {
    raw: "+18005550199",
    country: "US",
    type: "TOLL_FREE",
    withLandlines: false,
    withoutLandlines: false,
    reason: "toll_free",
  },
];

describe("logicalCheck", () => {
  it.each(fixtures)("$raw is $country $type", (f) => {
    const result = normalisePhone(f.raw);
    expect(result).toMatchObject({ ok: true, country: f.country, type: f.type });

    const keepAll = logicalCheck(result, { removeLandlines: false });
    expect(keepAll.keep).toBe(f.withLandlines);

    const mobileOnly = logicalCheck(result, { removeLandlines: true });
    expect(mobileOnly.keep).toBe(f.withoutLandlines);
    if (!mobileOnly.keep) {
      expect(mobileOnly.reason).toBe(f.reason);
    }
  });

  it("passes the normalisation failure reason through", () => {
    expect(logicalCheck(normalisePhone("abc"), { removeLandlines: true })).toEqual({
      keep: false,
      reason: "unparseable",
    });
    expect(logicalCheck(normalisePhone("+34 6123"), { removeLandlines: true })).toEqual({
      keep: false,
      reason: "invalid",
    });
    expect(logicalCheck(normalisePhone("612345678"), { removeLandlines: true })).toEqual({
      keep: false,
      reason: "no_country",
    });
  });

  it("keeps a valid number whose type is unknown", () => {
    const result = {
      ok: true as const,
      e164: "+34612345678",
      country: "ES" as const,
      type: undefined,
    };
    expect(logicalCheck(result, { removeLandlines: true })).toEqual({ keep: true });
  });
});

describe("cleanBatch", () => {
  const rows = [
    "+34612345678",
    "0034 612 345 678",
    "612 345 678",
    "+34912345678",
    "+34900123456",
    "junk",
    "",
    "+33612345678",
  ];

  it("keeps mobiles, drops the rest with a reason, and counts duplicates by E.164", () => {
    const out = cleanBatch(rows, { defaultCountry: "ES", removeLandlines: true, dedupe: true });
    expect(out.kept).toEqual([
      { e164: "+34612345678", country: "ES" },
      { e164: "+33612345678", country: "FR" },
    ]);
    expect(out.duplicates).toBe(2);
    expect(out.dropped).toEqual([
      { raw: "+34912345678", reason: "landline" },
      { raw: "+34900123456", reason: "toll_free" },
      { raw: "junk", reason: "unparseable" },
      { raw: "", reason: "unparseable" },
    ]);
  });

  it("keeps repeats when dedupe is off", () => {
    const out = cleanBatch(rows, { defaultCountry: "ES", removeLandlines: true, dedupe: false });
    expect(out.kept.map((k) => k.e164)).toEqual([
      "+34612345678",
      "+34612345678",
      "+34612345678",
      "+33612345678",
    ]);
    expect(out.duplicates).toBe(0);
  });

  it("keeps landlines when asked", () => {
    const out = cleanBatch(rows, { defaultCountry: "ES", removeLandlines: false, dedupe: true });
    expect(out.kept.map((k) => k.e164)).toContain("+34912345678");
    expect(out.dropped.map((d) => d.reason)).not.toContain("landline");
  });

  it("reports no_country for national numbers when no default country is given", () => {
    const out = cleanBatch(["612 345 678"], { removeLandlines: true, dedupe: true });
    expect(out.kept).toEqual([]);
    expect(out.dropped).toEqual([{ raw: "612 345 678", reason: "no_country" }]);
  });

  // libphonenumber parses each number; 50k numbers took 5.3 s on a CI runner once, so the
  // test gets its own budget instead of the 5 s default.
  it("handles a large batch without recursion", { timeout: 30_000 }, () => {
    const big = Array.from(
      { length: 50_000 },
      (_, i) => `+3461234${String(i % 10_000).padStart(4, "0")}`,
    );
    const out = cleanBatch(big, { removeLandlines: true, dedupe: true });
    expect(out.kept).toHaveLength(10_000);
    expect(out.duplicates).toBe(40_000);
    expect(out.dropped).toEqual([]);
  });
});

describe("isSuspiciousPattern", () => {
  it("flags repeated digits, straight runs and long zero tails on the national part", () => {
    expect(isSuspiciousPattern("+491770000000")).toBe(true);
    expect(isSuspiciousPattern("+4958000000000")).toBe(true);
    expect(isSuspiciousPattern("+34666666666")).toBe(true);
    expect(isSuspiciousPattern("+34612345678")).toBe(true);
    expect(isSuspiciousPattern("+34698765432")).toBe(true);
  });

  it("keeps ordinary numbers, even with a few zeros", () => {
    expect(isSuspiciousPattern("+34622000001")).toBe(false);
    expect(isSuspiciousPattern("+447700900123")).toBe(false);
    expect(isSuspiciousPattern("+35699001122")).toBe(false);
  });
});

describe("normalisePhone: country code without a plus, with a list country", () => {
  it("reads a German mobile that starts with 49 as +49…, not as a local landline", () => {
    // SMS Edge exports write numbers as 4915123456789. Read as a local German number it
    // passes as a landline (+49 4915123456789), which flagged a whole file Bad.
    expect(normalisePhone("4915123456789", "DE")).toMatchObject({
      ok: true,
      e164: "+4915123456789",
      country: "DE",
      type: "MOBILE",
    });
  });

  it("gives the same number for every way of writing it", () => {
    for (const raw of ["+4915123456789", "004915123456789", "015123456789", "15123456789"]) {
      expect(normalisePhone(raw, "DE"), raw).toMatchObject({ ok: true, e164: "+4915123456789" });
    }
  });

  it("reads a German landline that starts with 49 as +49…, too", () => {
    expect(normalisePhone("4930123456", "DE")).toMatchObject({
      ok: true,
      e164: "+4930123456",
      type: "FIXED_LINE",
    });
  });

  it("does the same for Austria, whose plan is as loose as Germany's", () => {
    expect(normalisePhone("436641234567", "AT")).toMatchObject({
      ok: true,
      e164: "+436641234567",
      type: "MOBILE",
    });
  });

  it("still reads a local number when the country-code reading is not a valid number", () => {
    // +612345678 and +07424473269 are not numbers, so only the local reading is left.
    expect(normalisePhone("612345678", "ES")).toMatchObject({ ok: true, e164: "+34612345678" });
    expect(normalisePhone("07424473269", "GB")).toMatchObject({ ok: true, e164: "+447424473269" });
  });

  it("still accepts another country's number written without a plus", () => {
    expect(normalisePhone("447424473269", "DE")).toMatchObject({
      ok: true,
      e164: "+447424473269",
      country: "GB",
    });
  });
});

describe("normalisePhone: numbers cut short by a spreadsheet", () => {
  it("rejects scientific notation as damaged instead of reading its digits", () => {
    for (const raw of [
      "4.91516E+12",
      "4.9175E+11",
      "4,91516E+12",
      "4.91516e+12",
      " 4.91516E12 ",
      "5E+11",
    ]) {
      expect(normalisePhone(raw, "DE"), raw).toEqual({ ok: false, reason: "damaged" });
      expect(isSpreadsheetDamaged(raw), raw).toBe(true);
    }
  });

  it("does not call ordinary numbers damaged", () => {
    for (const raw of [
      "4915123456789",
      "+49 151 2345 6789",
      "0151-23456789",
      "abc",
      "",
      "1.5",
      "E+12",
    ]) {
      expect(isSpreadsheetDamaged(raw), raw).toBe(false);
    }
  });

  it("counts damaged cells in a column", () => {
    expect(countSpreadsheetDamaged(["4.91516E+12", "4915123456789", "4.9175E+11", ""])).toBe(2);
  });
});
