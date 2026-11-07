import { describe, expect, it } from "vitest";
import {
  calendarQueryString,
  calendarSpan,
  parseCalendarQuery,
  shiftCalendar,
} from "./calendar-params";

const NOW = new Date("2026-11-07T15:00:00Z");

describe("parseCalendarQuery", () => {
  it("defaults to the current month and today", () => {
    expect(parseCalendarQuery({}, NOW)).toEqual({
      view: "month",
      year: 2026,
      month: 11,
      day: "2026-11-07",
    });
  });

  it("reads a month, a week day and drops malformed values", () => {
    expect(parseCalendarQuery({ month: "2026-09" }, NOW)).toMatchObject({ year: 2026, month: 9 });
    expect(parseCalendarQuery({ month: "2026-13" }, NOW)).toMatchObject({ year: 2026, month: 11 });
    expect(parseCalendarQuery({ view: "week", day: "2026-10-29" }, NOW)).toEqual({
      view: "week",
      year: 2026,
      month: 10,
      day: "2026-10-29",
    });
    expect(parseCalendarQuery({ view: "year" }, NOW).view).toBe("month");
  });
});

describe("calendarQueryString", () => {
  it("is empty for the current month and names other states", () => {
    expect(calendarQueryString(parseCalendarQuery({}, NOW), NOW)).toBe("");
    expect(
      calendarQueryString({ view: "month", year: 2026, month: 9, day: "2026-11-07" }, NOW),
    ).toBe("?month=2026-09");
    expect(
      calendarQueryString({ view: "week", year: 2026, month: 11, day: "2026-11-07" }, NOW),
    ).toBe("?view=week&day=2026-11-07");
  });
});

describe("calendarSpan / shiftCalendar", () => {
  it("covers the month or the week and moves by one", () => {
    const month = parseCalendarQuery({ month: "2026-11" }, NOW);
    expect(calendarSpan(month)).toEqual({
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-12-01T00:00:00Z"),
    });
    expect(shiftCalendar(month, 1)).toMatchObject({ year: 2026, month: 12 });
    expect(shiftCalendar(month, -11)).toMatchObject({ year: 2025, month: 12 });

    const week = parseCalendarQuery({ view: "week", day: "2026-11-07" }, NOW);
    expect(calendarSpan(week)).toEqual({
      from: new Date("2026-11-02T00:00:00Z"),
      to: new Date("2026-11-09T00:00:00Z"),
    });
    expect(shiftCalendar(week, 1)).toEqual({
      view: "week",
      year: 2026,
      month: 11,
      day: "2026-11-09",
    });
    expect(shiftCalendar(week, -2).day).toBe("2026-10-19");
  });
});
