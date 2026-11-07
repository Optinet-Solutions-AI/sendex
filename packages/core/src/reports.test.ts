import { describe, expect, it } from "vitest";
import {
  addMonths,
  type CountryDayStats,
  calendarKpis,
  dayCells,
  formatCpc,
  formatLogDay,
  formatMonth,
  logKpis,
  monthGrid,
  monthRange,
  shiftWeek,
  weekGrid,
  weekRange,
} from "./reports.js";

describe("logKpis", () => {
  it("sums the rows and derives CTR and CPC", () => {
    const kpis = logKpis([
      { sent: 1000, clicks: 20, spendMicro: 40_000_000n, leads: 2, sales: 1 },
      { sent: 500, clicks: 10, spendMicro: 20_000_000n, leads: 1, sales: 0 },
    ]);
    expect(kpis).toEqual({
      sent: 1500,
      clicks: 30,
      ctr: 0.02,
      spendMicro: 60_000_000n,
      cpcMicro: 2_000_000n,
      leads: 3,
      sales: 1,
    });
  });

  it("has no CPC or CTR without clicks or sends", () => {
    const kpis = logKpis([{ sent: 0, clicks: 0, spendMicro: 0n, leads: 0, sales: 0 }]);
    expect(kpis.ctr).toBe(0);
    expect(kpis.cpcMicro).toBeNull();
  });
});

describe("formatCpc", () => {
  it("shows four decimals and a dash without clicks", () => {
    expect(formatCpc(2_171_500n)).toBe("€2.1715");
    expect(formatCpc(1_802_512n)).toBe("€1.8025");
    expect(formatCpc(null)).toBe("—");
  });
});

describe("formatLogDay / formatMonth", () => {
  it("renders the spec's date styles", () => {
    expect(formatLogDay("2026-11-06")).toBe("Nov 6, 2026");
    expect(formatMonth(2026, 11)).toBe("November 2026");
  });
});

describe("monthGrid", () => {
  it("starts on the Monday before the first and ends on the Sunday after the last", () => {
    const weeks = monthGrid(2026, 11);
    // 1 Nov 2026 is a Sunday: the row starts on Monday 26 Oct.
    expect(weeks[0]?.[0]).toEqual({ day: "2026-10-26", inMonth: false });
    expect(weeks[0]?.[6]).toEqual({ day: "2026-11-01", inMonth: true });
    const last = weeks[weeks.length - 1];
    expect(last?.[6]).toEqual({ day: "2026-12-06", inMonth: false });
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
  });

  it("has five rows when the month fits", () => {
    // Feb 2027 starts on a Monday and has 28 days.
    expect(monthGrid(2027, 2)).toHaveLength(4);
    expect(monthGrid(2026, 6)).toHaveLength(5);
  });
});

describe("monthRange / addMonths", () => {
  it("bounds the month in UTC, end exclusive", () => {
    expect(monthRange(2026, 11)).toEqual({
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(monthRange(2026, 12).to).toEqual(new Date("2027-01-01T00:00:00.000Z"));
  });

  it("moves across year ends", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("weekGrid / weekRange / shiftWeek", () => {
  it("is the Monday to Sunday around a day", () => {
    const week = weekGrid("2026-11-07");
    expect(week.map((c) => c.day)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(week.every((c) => c.inMonth)).toBe(true);
    expect(weekRange("2026-11-07")).toEqual({
      from: new Date("2026-11-02T00:00:00.000Z"),
      to: new Date("2026-11-09T00:00:00.000Z"),
    });
    expect(shiftWeek("2026-11-07", 1)).toBe("2026-11-14");
    expect(shiftWeek("2026-11-02", -1)).toBe("2026-10-26");
  });
});

const stats: CountryDayStats[] = [
  { day: "2026-11-03", country: "GB", sent: 2722, clicks: 51, campaigns: 2 },
  { day: "2026-11-03", country: "PL", sent: 2000, clicks: 47, campaigns: 1 },
  { day: "2026-11-03", country: "FR", sent: 1500, clicks: 30, campaigns: 1 },
  { day: "2026-11-03", country: "DE", sent: 1000, clicks: 10, campaigns: 1 },
  { day: "2026-11-03", country: "ES", sent: 439, clicks: 4, campaigns: 1 },
  { day: "2026-11-04", country: "PL", sent: 8661, clicks: 100, campaigns: 3 },
];

describe("dayCells", () => {
  it("totals each day, ranks countries by sent and scales the bar to the busiest day", () => {
    const cells = dayCells(stats);
    const nov3 = cells.get("2026-11-03");
    expect(nov3?.sent).toBe(7661);
    expect(nov3?.clicks).toBe(142);
    expect(nov3?.countries.map((c) => c.country)).toEqual(["GB", "PL", "FR", "DE", "ES"]);
    expect(nov3?.countries[1]?.ctr).toBeCloseTo(0.0235, 4);
    expect(nov3?.barFraction).toBeCloseTo(7661 / 8661, 4);
    expect(cells.get("2026-11-04")?.barFraction).toBe(1);
  });

  it("is empty without stats", () => {
    expect(dayCells([]).size).toBe(0);
  });
});

describe("calendarKpis", () => {
  it("counts sent, clicks, CTR, countries, campaign sends and country-days", () => {
    expect(calendarKpis(stats)).toEqual({
      sent: 16322,
      clicks: 242,
      ctr: 242 / 16322,
      countries: 5,
      campaignSends: 9,
      countryDays: 6,
    });
  });
});
