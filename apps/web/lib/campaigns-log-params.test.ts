import { describe, expect, it } from "vitest";
import { campaignsLogQueryString, logWindow, parseCampaignsLogQuery } from "./campaigns-log-params";

describe("parseCampaignsLogQuery", () => {
  it("defaults to the last 7 days, every country, page 1", () => {
    expect(parseCampaignsLogQuery({})).toEqual({
      period: "7d",
      from: "",
      to: "",
      countries: [],
      page: 1,
    });
  });

  it("reads the period, countries and dates and drops malformed values", () => {
    expect(
      parseCampaignsLogQuery({
        period: "custom",
        from: "2026-11-01",
        to: "nope",
        country: ["es", "GB", "zzz"],
        page: "3",
      }),
    ).toEqual({ period: "custom", from: "2026-11-01", to: "", countries: ["ES", "GB"], page: 3 });
    expect(parseCampaignsLogQuery({ period: "90d" }).period).toBe("7d");
  });
});

describe("campaignsLogQueryString", () => {
  it("leaves defaults out and repeats country", () => {
    expect(campaignsLogQueryString({ period: "7d", countries: [], page: 1 })).toBe("");
    expect(
      campaignsLogQueryString({
        period: "custom",
        from: "2026-11-01",
        to: "2026-11-07",
        countries: ["ES", "GB"],
        page: 2,
      }),
    ).toBe("?period=custom&from=2026-11-01&to=2026-11-07&country=ES&country=GB&page=2");
    expect(campaignsLogQueryString({ period: "today", from: "2026-01-01" })).toBe("?period=today");
  });
});

describe("logWindow", () => {
  const now = new Date("2026-11-07T15:30:00Z");
  const base = { from: "", to: "", countries: [], page: 1 };

  it("covers today, the last 7 days or the last 30 days, end exclusive", () => {
    expect(logWindow({ ...base, period: "today" }, now)).toEqual({
      from: new Date("2026-11-07T00:00:00Z"),
      to: new Date("2026-11-08T00:00:00Z"),
    });
    expect(logWindow({ ...base, period: "7d" }, now).from).toEqual(
      new Date("2026-11-01T00:00:00Z"),
    );
    expect(logWindow({ ...base, period: "30d" }, now).from).toEqual(
      new Date("2026-10-09T00:00:00Z"),
    );
  });

  it("covers whole custom days and falls back when a bound is missing", () => {
    expect(
      logWindow({ ...base, period: "custom", from: "2026-10-01", to: "2026-10-31" }, now),
    ).toEqual({
      from: new Date("2026-10-01T00:00:00Z"),
      to: new Date("2026-11-01T00:00:00Z"),
    });
    expect(logWindow({ ...base, period: "custom" }, now)).toEqual(
      logWindow({ ...base, period: "30d" }, now),
    );
  });
});
