import { describe, expect, it } from "vitest";
import {
  EMPTY_SENDING_HOURS,
  formatSendingHoursText,
  outsideSendingHours,
  parseSendingHoursText,
  sendingHoursFor,
  sendingHoursFromForm,
  sendingHoursSchema,
} from "./sending-hours.js";

// D4-14, decisions item 34: suggested sending hours are a hint, never a block.
const HOURS = {
  default: { from: "09:00", to: "20:00" },
  countries: { ES: { from: "10:00", to: "21:00" } },
};

describe("sendingHoursFor", () => {
  it("uses the country's own window, else the default, else nothing", () => {
    expect(sendingHoursFor(HOURS, "es")).toEqual({ from: "10:00", to: "21:00" });
    expect(sendingHoursFor(HOURS, "FR")).toEqual({ from: "09:00", to: "20:00" });
    expect(sendingHoursFor(EMPTY_SENDING_HOURS, "FR")).toBeNull();
  });
});

describe("outsideSendingHours", () => {
  // 14 Sep 2026 is summer time: Madrid is UTC+2.
  it("is null inside the window, in the campaign's own time zone", () => {
    const at = new Date("2026-09-14T08:00:00Z"); // 10:00 in Madrid
    expect(outsideSendingHours(HOURS, "ES", "Europe/Madrid", at)).toBeNull();
    expect(
      outsideSendingHours(HOURS, "ES", "Europe/Madrid", new Date("2026-09-14T18:59:00Z")),
    ).toBeNull(); // 20:59
  });

  it("reports the window and the local time outside it", () => {
    expect(
      outsideSendingHours(HOURS, "ES", "Europe/Madrid", new Date("2026-09-14T19:00:00Z")),
    ).toEqual({ window: { from: "10:00", to: "21:00" }, localTime: "21:00" });
    expect(
      outsideSendingHours(HOURS, "ES", "Europe/Madrid", new Date("2026-09-14T07:59:00Z")),
    ).toEqual({ window: { from: "10:00", to: "21:00" }, localTime: "09:59" });
  });

  it("says nothing when no hours are set for the country", () => {
    const at = new Date("2026-09-14T01:00:00Z");
    expect(outsideSendingHours(EMPTY_SENDING_HOURS, "ES", "Europe/Madrid", at)).toBeNull();
    expect(
      outsideSendingHours({ default: null, countries: HOURS.countries }, "FR", "Europe/Paris", at),
    ).toBeNull();
  });
});

describe("sendingHoursSchema", () => {
  it("accepts a default and per-country windows", () => {
    expect(sendingHoursSchema.parse(HOURS)).toEqual(HOURS);
    expect(sendingHoursSchema.parse(EMPTY_SENDING_HOURS)).toEqual(EMPTY_SENDING_HOURS);
  });

  it("rejects malformed times, a window that ends before it starts and bad country codes", () => {
    const bad = [
      { default: { from: "9:00", to: "20:00" }, countries: {} },
      { default: { from: "25:00", to: "26:00" }, countries: {} },
      { default: { from: "20:00", to: "09:00" }, countries: {} },
      { default: null, countries: { Spain: { from: "09:00", to: "20:00" } } },
    ];
    for (const value of bad) expect(sendingHoursSchema.safeParse(value).success).toBe(false);
  });
});

describe("the per-country text box", () => {
  it("reads one country per line and writes it back sorted", () => {
    const parsed = parseSendingHoursText("es 10:00-21:00\n\nGB 09:00 - 20:30\n");
    expect(parsed).toEqual({
      ok: true,
      countries: { ES: { from: "10:00", to: "21:00" }, GB: { from: "09:00", to: "20:30" } },
    });
    expect(formatSendingHoursText(HOURS.countries)).toBe("ES 10:00-21:00");
    expect(
      formatSendingHoursText({
        GB: { from: "09:00", to: "20:30" },
        ES: { from: "10:00", to: "21:00" },
      }),
    ).toBe("ES 10:00-21:00\nGB 09:00-20:30");
  });

  it("names the first line it cannot read", () => {
    expect(parseSendingHoursText("ES 10:00-21:00\nFrance nine to five")).toEqual({
      ok: false,
      error: 'Line 2 is not "CC HH:MM-HH:MM": France nine to five',
    });
    expect(parseSendingHoursText("ES 21:00-10:00")).toEqual({
      ok: false,
      error: "Line 1: the hours must end after they start: ES 21:00-10:00",
    });
  });
});

describe("sendingHoursFromForm", () => {
  it("builds the hours from the default times and the per-country box", () => {
    expect(
      sendingHoursFromForm({
        defaultFrom: "09:00",
        defaultTo: "20:00",
        countriesText: "ES 10:00-21:00",
      }),
    ).toEqual({ ok: true, hours: HOURS });
    expect(sendingHoursFromForm({ defaultFrom: "", defaultTo: "", countriesText: "" })).toEqual({
      ok: true,
      hours: EMPTY_SENDING_HOURS,
    });
  });

  it("explains what is wrong", () => {
    expect(
      sendingHoursFromForm({ defaultFrom: "09:00", defaultTo: "", countriesText: "" }),
    ).toEqual({ ok: false, error: "Fill in both default times, or leave both empty." });
    expect(
      sendingHoursFromForm({ defaultFrom: "20:00", defaultTo: "09:00", countriesText: "" }),
    ).toEqual({ ok: false, error: "The default hours must end after they start." });
    expect(sendingHoursFromForm({ defaultFrom: "", defaultTo: "", countriesText: "nope" })).toEqual(
      { ok: false, error: 'Line 1 is not "CC HH:MM-HH:MM": nope' },
    );
  });
});
