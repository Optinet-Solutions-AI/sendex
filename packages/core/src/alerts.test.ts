import { describe, expect, it } from "vitest";
import { alertSummary, groupAlerts } from "./alerts.js";

const spike = (lastHour: number, sevenDayHourlyAverage: number, ratio: number | null) => ({
  kind: "send_spike",
  message: "Sending spike: long text kept for the audit log.",
  details: { lastHour, sevenDayHourlyAverage, ratio },
});

describe("alertSummary (D5-24)", () => {
  it("says a sending spike in plain words, without repeating the alert's name", () => {
    expect(alertSummary(spike(2850, 51.3, 55.5))).toBe(
      "2,850 SMS in one hour, about 56× the usual 51 an hour.",
    );
    expect(alertSummary(spike(150, 6, 25.2))).toBe(
      "150 SMS in one hour, about 25× the usual 6 an hour.",
    );
    expect(alertSummary(spike(600, 100, 6))).toBe(
      "600 SMS in one hour, about 6× the usual 100 an hour.",
    );
  });

  it("does not show a silly multiple when the week before was almost quiet", () => {
    expect(alertSummary(spike(200, 0.02, 11_200))).toBe(
      "200 SMS in one hour, after an almost quiet week.",
    );
    expect(alertSummary(spike(100, 0, null))).toBe("100 SMS in one hour, after a quiet week.");
  });

  it("drops the alert's name from the start of other messages", () => {
    expect(
      alertSummary({
        kind: "low_balance",
        message: "Low balance: €4.20 left on 23Telecom.",
        details: {},
      }),
    ).toBe("€4.20 left on 23Telecom.");
    expect(
      alertSummary({
        kind: "daily_message_cap",
        message: "Daily message cap of 1 reached: 599 messages refused.",
        details: {},
      }),
    ).toBe("Daily message cap of 1 reached: 599 messages refused.");
  });

  it("falls back to the stored message when a spike has no numbers", () => {
    expect(
      alertSummary({ kind: "send_spike", message: "Sending spike: 9 messages.", details: null }),
    ).toBe("9 messages.");
  });
});

describe("groupAlerts (D5-24)", () => {
  const at = (iso: string) => new Date(iso);
  const alerts = [
    { id: "s1", kind: "send_spike", raisedAt: at("2026-11-26T20:00:00Z") },
    { id: "b1", kind: "low_balance", raisedAt: at("2026-11-25T08:00:00Z") },
    { id: "s2", kind: "send_spike", raisedAt: at("2026-11-25T19:00:00Z") },
    { id: "s3", kind: "send_spike", raisedAt: at("2026-11-27T19:05:00Z") },
  ];

  it("keeps one group per kind, newest alert first, groups by their newest alert", () => {
    const groups = groupAlerts(alerts);
    expect(groups.map((g) => g.kind)).toEqual(["send_spike", "low_balance"]);
    expect(groups[0]?.latest.id).toBe("s3");
    expect(groups[0]?.earlier.map((a) => a.id)).toEqual(["s1", "s2"]);
    expect(groups[0]?.ids).toEqual(["s3", "s1", "s2"]);
    expect(groups[1]?.earlier).toEqual([]);
  });

  it("gives nothing for no alerts", () => {
    expect(groupAlerts([])).toEqual([]);
  });
});
