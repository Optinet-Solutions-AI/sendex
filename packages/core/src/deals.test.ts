import { describe, expect, it } from "vitest";
import {
  cpaFromDeal,
  dealKey,
  dealSheetColumns,
  parseDealSheet,
  setOfferDealSchema,
  suggestDealForOffer,
  uploadDealsSchema,
} from "./deals.js";

describe("cpaFromDeal", () => {
  it("reads the CPA of a Media Deals deal and leaves out revshare and base", () => {
    expect(cpaFromDeal("€200 CPA + 40% rev + €20 base")).toEqual({ cpaMicro: 200_000_000n });
    expect(cpaFromDeal("€250 CPA")).toEqual({ cpaMicro: 250_000_000n });
  });

  it("reads the currency written after the amount or the word EUR", () => {
    expect(cpaFromDeal("180€ CPA + 30% rev")).toEqual({ cpaMicro: 180_000_000n });
    expect(cpaFromDeal("EUR 150 CPA")).toEqual({ cpaMicro: 150_000_000n });
    expect(cpaFromDeal("CPA €120.50")).toEqual({ cpaMicro: 120_500_000n });
  });

  it("gives no price when the deal has no CPA", () => {
    expect(cpaFromDeal("No Deal Yet")).toEqual({ cpaMicro: null, reason: "No CPA in the deal" });
    expect(cpaFromDeal("40% rev share")).toEqual({ cpaMicro: null, reason: "No CPA in the deal" });
    expect(cpaFromDeal("")).toEqual({ cpaMicro: null, reason: "No CPA in the deal" });
  });

  it("gives no price for a CPA that is not in euros", () => {
    expect(cpaFromDeal("$200 CPA")).toEqual({ cpaMicro: null, reason: "CPA not in euros" });
    expect(cpaFromDeal("USD 150 CPA + 30% rev")).toEqual({
      cpaMicro: null,
      reason: "CPA not in euros",
    });
  });

  it("gives no price when the CPA has no currency or there is more than one CPA", () => {
    expect(cpaFromDeal("120 CPA + 35% 21 BL")).toEqual({
      cpaMicro: null,
      reason: "No currency on the CPA",
    });
    expect(cpaFromDeal("€300 CPA + €30 CPA + €20 CPA")).toEqual({
      cpaMicro: null,
      reason: "More than one CPA in the deal",
    });
  });
});

describe("dealKey", () => {
  it("ignores case and extra spaces", () => {
    expect(dealKey(" Aff  Republic ", "Smash")).toBe(dealKey("aff republic", "SMASH"));
    expect(dealKey("Aff Republic", "Smash")).not.toBe(dealKey("Cash Hunter", "Smash"));
  });
});

const HEADER = [
  "Affiliate Program Name",
  "Program URL",
  "Product Platform",
  "Tracking Platform",
  "ALL BRANDS",
  "Contact",
  "Telegram",
  "Skype",
  "User Name",
  "PASS",
  "Email",
  "Deal",
  "Top Geos",
  "Comments",
];

function row(program: string, brands: string, deal: string, geos = ""): string[] {
  return [program, "", "", "", brands, "x", "x", "x", "user", "secret", "a@b.c", deal, geos, ""];
}

describe("parseDealSheet", () => {
  it("reads Media Deals' export: one deal per brand, and never the login columns", () => {
    const result = parseDealSheet([
      HEADER,
      row("Aff Republic", "Smash | Shark", "€220 CPA + 40% rev", "UK, IE"),
      row("HODL", "Winboost", "$200 CPA"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problems).toEqual([]);
    expect(result.deals).toEqual([
      {
        key: dealKey("Aff Republic", "Smash"),
        program: "Aff Republic",
        brand: "Smash",
        deal: "€220 CPA + 40% rev",
        topGeos: "UK, IE",
        startsOn: null,
        cpaMicro: 220_000_000n,
        reason: null,
      },
      {
        key: dealKey("Aff Republic", "Shark"),
        program: "Aff Republic",
        brand: "Shark",
        deal: "€220 CPA + 40% rev",
        topGeos: "UK, IE",
        startsOn: null,
        cpaMicro: 220_000_000n,
        reason: null,
      },
      {
        key: dealKey("HODL", "Winboost"),
        program: "HODL",
        brand: "Winboost",
        deal: "$200 CPA",
        topGeos: "",
        startsOn: null,
        cpaMicro: null,
        reason: "CPA not in euros",
      },
    ]);
    const text = JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? String(v) : v));
    expect(text).not.toContain("secret");
    expect(text).not.toContain("a@b.c");
  });

  it("splits brands written on separate lines and skips rows without a brand", () => {
    const result = parseDealSheet([HEADER, row("Uno", "Alpha\nBeta", "€180 CPA"), row("", "", "")]);
    expect(result.ok && result.deals.map((d) => d.brand)).toEqual(["Alpha", "Beta"]);
  });

  it("finds the header below title rows and accepts the short header names", () => {
    const result = parseDealSheet([
      ["Media Deals export"],
      [],
      ["affiliate program", "brand", "commercial deal"],
      ["HODL", "Winboost", "€250 CPA"],
    ]);
    expect(result.ok && result.deals.map((d) => [d.brand, d.cpaMicro])).toEqual([
      ["Winboost", 250_000_000n],
    ]);
  });

  it("reads a date column, so a deal can start on the day written in the sheet", () => {
    const result = parseDealSheet([
      ["Affiliate Program Name", "ALL BRANDS", "Deal", "Start Date"],
      ["HODL", "Winboost", "€250 CPA", "2026-11-01"],
      ["HODL", "Wintino", "€200 CPA", "15/10/2026"],
      ["HODL", "Smash", "€210 CPA", "03.09.2026"],
      ["HODL", "Shark", "€190 CPA", ""],
      ["HODL", "Roy Boy", "€190 CPA", "next week"],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals.map((d) => [d.brand, d.startsOn])).toEqual([
      ["Winboost", "2026-11-01"],
      ["Wintino", "2026-10-15"],
      ["Smash", "2026-09-03"],
      ["Shark", null],
    ]);
    expect(result.problems).toEqual(['Row 6: the date "next week" is not a date (use YYYY-MM-DD)']);
  });

  it("refuses a sheet without a brand or a deal column", () => {
    expect(
      parseDealSheet([
        ["Name", "Phone"],
        ["a", "b"],
      ]),
    ).toEqual({
      ok: false,
      error: 'No "ALL BRANDS" and "Deal" columns found. Upload the Media Deals export.',
    });
    expect(parseDealSheet([])).toEqual({
      ok: false,
      error: 'No "ALL BRANDS" and "Deal" columns found. Upload the Media Deals export.',
    });
  });
});

describe("dealSheetColumns", () => {
  it("keeps only the deal columns, so logins never leave the browser", () => {
    const kept = dealSheetColumns([
      ["Media Deals export"],
      HEADER,
      row("Aff Republic", "Smash | Shark", "€220 CPA", "UK"),
    ]);
    expect(kept).toEqual([
      ["Affiliate Program Name", "ALL BRANDS", "Deal", "Top Geos"],
      ["Aff Republic", "Smash | Shark", "€220 CPA", "UK"],
    ]);
    expect(kept && parseDealSheet(kept)).toMatchObject({ ok: true, problems: [] });
  });

  it("keeps a date column and gives null without the brand and deal columns", () => {
    expect(
      dealSheetColumns([
        ["Brand", "Deal", "PASS", "Start Date"],
        ["A", "€1 CPA", "x", ""],
      ]),
    ).toEqual([
      ["Brand", "Deal", "Start Date"],
      ["A", "€1 CPA", ""],
    ]);
    expect(dealSheetColumns([["Name", "PASS"]])).toBeNull();
  });
});

describe("suggestDealForOffer", () => {
  const deals = [
    { key: "a|smash", brand: "Smash" },
    { key: "a|smash casino", brand: "Smash Casino" },
    { key: "b|win", brand: "Win" },
    { key: "c|winboost", brand: "Winboost" },
  ];

  it("suggests the longest brand whose name is in the offer name", () => {
    expect(suggestDealForOffer("Smash Casino UK - Nov", deals)).toBe("a|smash casino");
    expect(suggestDealForOffer("winboost_uk_a35", deals)).toBe("c|winboost");
  });

  it("matches whole words only and suggests nothing otherwise", () => {
    expect(suggestDealForOffer("Winners club", deals)).toBeNull();
    expect(suggestDealForOffer("Roy Boy", deals)).toBeNull();
  });
});

describe("upload and offer schemas", () => {
  it("takes the rows of the file and a start date", () => {
    expect(
      uploadDealsSchema.parse({ startsOn: "2026-11-25", fileName: "deals.csv", rows: [["a"]] }),
    ).toEqual({ startsOn: "2026-11-25", fileName: "deals.csv", rows: [["a"]] });
    expect(() =>
      uploadDealsSchema.parse({ startsOn: "25/11/2026", fileName: "d.csv", rows: [] }),
    ).toThrow();
  });

  it("takes an offer and a deal, or no deal", () => {
    const linkId = "4f1b2c3d-1234-4abc-8def-1234567890ab";
    expect(setOfferDealSchema.parse({ linkId, dealKey: null })).toEqual({ linkId, dealKey: null });
    expect(() => setOfferDealSchema.parse({ linkId: "x", dealKey: null })).toThrow();
  });
});
