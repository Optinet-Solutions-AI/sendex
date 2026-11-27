import { describe, expect, it } from "vitest";
import {
  addDealSchema,
  cpaFromDeal,
  dealFromForm,
  dealKey,
  dealSheetColumns,
  parseDealSheet,
  scaleoDealKey,
  scaleoOfferIdFromUrl,
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
    expect(dealKey(" Example  Partners ", "Brand A")).toBe(dealKey("example partners", "BRAND A"));
    expect(dealKey("Example Partners", "Brand A")).not.toBe(dealKey("Sample Network", "Brand A"));
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
      row("Example Partners", "Brand A | Brand B", "€220 CPA + 40% rev", "UK, IE"),
      row("Demo Affiliates", "Brand C", "$200 CPA"),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problems).toEqual([]);
    expect(result.deals).toEqual([
      {
        key: dealKey("Example Partners", "Brand A"),
        program: "Example Partners",
        brand: "Brand A",
        deal: "€220 CPA + 40% rev",
        topGeos: "UK, IE",
        startsOn: null,
        cpaMicro: 220_000_000n,
        reason: null,
      },
      {
        key: dealKey("Example Partners", "Brand B"),
        program: "Example Partners",
        brand: "Brand B",
        deal: "€220 CPA + 40% rev",
        topGeos: "UK, IE",
        startsOn: null,
        cpaMicro: 220_000_000n,
        reason: null,
      },
      {
        key: dealKey("Demo Affiliates", "Brand C"),
        program: "Demo Affiliates",
        brand: "Brand C",
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
      ["Demo Affiliates", "Brand C", "€250 CPA"],
    ]);
    expect(result.ok && result.deals.map((d) => [d.brand, d.cpaMicro])).toEqual([
      ["Brand C", 250_000_000n],
    ]);
  });

  it("reads a date column, so a deal can start on the day written in the sheet", () => {
    const result = parseDealSheet([
      ["Affiliate Program Name", "ALL BRANDS", "Deal", "Start Date"],
      ["Demo Affiliates", "Brand C", "€250 CPA", "2026-11-01"],
      ["Demo Affiliates", "Brand D", "€200 CPA", "15/10/2026"],
      ["Demo Affiliates", "Brand A", "€210 CPA", "03.09.2026"],
      ["Demo Affiliates", "Brand B", "€190 CPA", ""],
      ["Demo Affiliates", "Roy Boy", "€190 CPA", "next week"],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals.map((d) => [d.brand, d.startsOn])).toEqual([
      ["Brand C", "2026-11-01"],
      ["Brand D", "2026-10-15"],
      ["Brand A", "2026-09-03"],
      ["Brand B", null],
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
      row("Example Partners", "Brand A | Brand B", "€220 CPA", "UK"),
    ]);
    expect(kept).toEqual([
      ["Affiliate Program Name", "ALL BRANDS", "Deal", "Top Geos"],
      ["Example Partners", "Brand A | Brand B", "€220 CPA", "UK"],
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
    { key: "a|alpha", brand: "Alpha" },
    { key: "a|alpha casino", brand: "Alpha Casino" },
    { key: "b|gam", brand: "Gam" },
    { key: "c|gamma", brand: "Gamma" },
  ];

  it("suggests the longest brand whose name is in the offer name", () => {
    expect(suggestDealForOffer("Alpha Casino UK - Nov", deals)).toBe("a|alpha casino");
    expect(suggestDealForOffer("gamma_uk_a35", deals)).toBe("c|gamma");
  });

  it("matches whole words only and suggests nothing otherwise", () => {
    expect(suggestDealForOffer("Gamers club", deals)).toBeNull();
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

describe("deals by Scaleo offer (D5-23)", () => {
  it("reads the Scaleo offer id from an offer link", () => {
    expect(
      scaleoOfferIdFromUrl("https://example.scaletrk.com/click?o=1234&a=42&sub_id1={{dynamic}}"),
    ).toBe(1234);
    expect(
      scaleoOfferIdFromUrl(
        "https://trk.example-tracker.com/click?o=567&a=42&sub_id1={{{dynamic}}}",
      ),
    ).toBe(567);
    expect(scaleoOfferIdFromUrl("https://example.com/landing?id={{dynamic}}")).toBeNull();
    expect(scaleoOfferIdFromUrl("not a url")).toBeNull();
  });

  it("keys a deal by its Scaleo offer, so offers find it by their link", () => {
    expect(scaleoDealKey(1234)).toBe("scaleo:1234");
  });

  it("takes a deal typed in Sendex: program, brand, Scaleo offer, euro CPA and start day", () => {
    expect(
      addDealSchema.parse({
        program: " Example Partners ",
        brand: "Brand A SMS",
        scaleoOfferId: "1234",
        cpaEur: "150",
        startsOn: "2026-11-01",
      }),
    ).toEqual({
      program: "Example Partners",
      brand: "Brand A SMS",
      scaleoOfferId: 1234,
      cpaEur: 150,
      startsOn: "2026-11-01",
    });
    expect(
      addDealSchema.parse({
        program: "P",
        brand: "B",
        scaleoOfferId: "",
        cpaEur: "120.5",
        startsOn: "2026-11-01",
      }).scaleoOfferId,
    ).toBeNull();
    expect(() =>
      addDealSchema.parse({
        program: "P",
        brand: "B",
        scaleoOfferId: "",
        cpaEur: "0",
        startsOn: "2026-11-01",
      }),
    ).toThrow();
    expect(() =>
      addDealSchema.parse({
        program: "",
        brand: "B",
        scaleoOfferId: "",
        cpaEur: "10",
        startsOn: "2026-11-01",
      }),
    ).toThrow();
  });

  it("turns a typed deal into the stored deal", () => {
    expect(
      dealFromForm({
        program: "Example Partners",
        brand: "Brand A SMS",
        scaleoOfferId: 1234,
        cpaEur: 150,
        startsOn: "2026-11-01",
      }),
    ).toEqual({
      key: "scaleo:1234",
      program: "Example Partners",
      brand: "Brand A SMS",
      deal: "€150 CPA (Scaleo offer 1234)",
      topGeos: "",
      startsOn: "2026-11-01",
      cpaMicro: 150_000_000n,
      reason: null,
    });
    expect(
      dealFromForm({
        program: "Example Partners",
        brand: "Rolling Slots",
        scaleoOfferId: null,
        cpaEur: 220.5,
        startsOn: "2026-11-01",
      }).key,
    ).toBe(dealKey("Example Partners", "Rolling Slots"));
  });
});
