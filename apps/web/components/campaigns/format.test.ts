import { describe, expect, it } from "vitest";
import {
  campaignTotals,
  formatDateTime,
  formatEur,
  formatMicro,
  formatPercent,
  formatPeriod,
  formatPricePerSms,
  shortId,
  toCsv,
} from "./format";

describe("money and percentages", () => {
  it("formats micro-EUR with two decimals", () => {
    expect(formatMicro(5_000_000)).toBe("EUR 5.00");
    expect(formatMicro("4988310000")).toBe("EUR 4,988.31");
    expect(formatMicro(0)).toBe("EUR 0.00");
  });

  it("formats EUR amounts and prices per SMS", () => {
    expect(formatEur(12.5)).toBe("EUR 12.50");
    expect(formatPricePerSms(25_000)).toBe("EUR 0.0250");
    expect(formatPricePerSms(null)).toBe("no price");
  });

  it("formats a ratio as a percentage", () => {
    expect(formatPercent(0.1234)).toBe("12.34%");
    expect(formatPercent(0)).toBe("0.00%");
  });
});

describe("dates", () => {
  it("formats a date in a timezone and a period from two dates", () => {
    const start = "2026-09-14T10:00:00.000Z";
    const end = "2026-09-14T12:30:00.000Z";
    expect(formatDateTime(start, "Europe/Madrid")).toBe("14 Sep 2026 12:00");
    expect(formatPeriod(start, end, "Europe/Madrid")).toBe("14 Sep 2026 12:00 – 14:30");
    expect(formatPeriod(start, null, "Europe/Madrid")).toBe("14 Sep 2026 12:00 –");
    expect(formatPeriod(null, null, "Europe/Madrid")).toBe("–");
  });
});

describe("campaignTotals", () => {
  it("sums laps and derives delivery rate, CTR, CPC, CPL and CPS", () => {
    const totals = campaignTotals([
      { sent: 100, delivered: 95, failed: 5, clicks: 10, leads: 2, sales: 1, costMicro: 2_500_000 },
      { sent: 100, delivered: 85, failed: 10, clicks: 0, leads: 0, sales: 0, costMicro: 2_700_000 },
    ]);
    expect(totals).toEqual({
      sent: 200,
      delivered: 180,
      failed: 15,
      deliveryRate: 0.9,
      clicks: 10,
      ctr: 0.05,
      leads: 2,
      sales: 1,
      costMicro: 5_200_000,
      cplMicro: 2_600_000,
      cpsMicro: 5_200_000,
      cpcMicro: 520_000,
    });
    expect(campaignTotals([])).toMatchObject({
      ctr: 0,
      deliveryRate: 0,
      cpcMicro: null,
      cplMicro: null,
      cpsMicro: null,
    });
  });

  it("shows 127 clicks on 2,394 sent as 5.30% CTR", () => {
    const lap = {
      sent: 2394,
      delivered: 2300,
      failed: 40,
      clicks: 127,
      leads: 0,
      sales: 0,
      costMicro: 0,
    };
    expect(formatPercent(campaignTotals([lap]).ctr)).toBe("5.30%");
  });
});

describe("csv and ids", () => {
  it("quotes fields containing commas, quotes or newlines", () => {
    expect(
      toCsv([
        ["a", 'b "c"', "d,e"],
        ["1", "2", "line\nbreak"],
      ]),
    ).toBe('a,"b ""c""","d,e"\r\n1,2,"line\nbreak"');
  });

  it("shortens a uuid to its first block", () => {
    expect(shortId("6d8f3c1a-1b2c-4d5e-8f90-abcdefabcdef")).toBe("6d8f3c1a");
  });
});
