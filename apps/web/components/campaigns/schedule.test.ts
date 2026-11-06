import { describe, expect, it } from "vitest";
import { isoToLocalInput, localInputToIso, scheduleNote } from "./schedule";

describe("schedule conversions", () => {
  it("turns a datetime-local value in the campaign zone into UTC ISO", () => {
    expect(localInputToIso("2026-09-14T12:00", "Europe/Madrid")).toBe("2026-09-14T10:00:00.000Z");
    expect(localInputToIso("2026-01-14T12:00", "Europe/Madrid")).toBe("2026-01-14T11:00:00.000Z");
    expect(localInputToIso("", "Europe/Madrid")).toBeNull();
    expect(localInputToIso("garbage", "Europe/Madrid")).toBeNull();
  });

  it("shows a UTC instant as the campaign zone's wall clock", () => {
    expect(isoToLocalInput("2026-09-14T10:00:00.000Z", "Europe/Madrid")).toBe("2026-09-14T12:00");
    expect(isoToLocalInput(null, "Europe/Madrid")).toBe("");
  });

  it("explains which zone the time is in", () => {
    expect(scheduleNote("ES", "Europe/Madrid")).toBe(
      "ES local time; will be sent according to Europe/Madrid",
    );
  });
});
