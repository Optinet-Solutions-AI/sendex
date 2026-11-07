import { describe, expect, it } from "vitest";
import { localClock } from "./laps-table";

describe("localClock", () => {
  it("shows the campaign's local time with the zone's short name, like ES 09:09 (CET)", () => {
    expect(localClock(new Date("2026-11-07T08:09:00Z"), "Europe/Madrid")).toBe("09:09 (CET)");
    expect(localClock(new Date("2026-07-07T08:09:00Z"), "Europe/Madrid")).toBe("10:09 (CEST)");
    expect(localClock(new Date("2026-11-07T08:09:00Z"), "Europe/London")).toBe("08:09 (GMT)");
  });
});
