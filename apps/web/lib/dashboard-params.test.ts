import { describe, expect, it } from "vitest";
import {
  dashboardQueryString,
  dashboardWindow,
  describeWindow,
  parseDashboardQuery,
} from "./dashboard-params";

const NOW = new Date("2026-11-07T12:00:00Z");

describe("parseDashboardQuery", () => {
  it("opens Getting Started over all time and every country by default", () => {
    expect(parseDashboardQuery({})).toEqual({
      tab: "getting-started",
      range: "all",
      from: "",
      to: "",
      countries: [],
      asset: "texts",
      q: "",
      threshold: 3,
      listsPage: 1,
    });
  });

  it("reads every field and drops malformed values", () => {
    expect(
      parseDashboardQuery({
        tab: "assets",
        asset: "sids",
        q: " fr ",
        range: "custom",
        from: "2026-10-01",
        to: "bad",
        country: "es,gb",
        threshold: "5",
        lists: "2",
      }),
    ).toEqual({
      tab: "assets",
      range: "custom",
      from: "2026-10-01",
      to: "",
      countries: ["ES", "GB"],
      asset: "sids",
      q: "fr",
      threshold: 5,
      listsPage: 2,
    });
    expect(parseDashboardQuery({ tab: "nope", range: "7d", threshold: "-1" })).toMatchObject({
      tab: "getting-started",
      range: "all",
      threshold: 3,
    });
  });
});

describe("dashboardQueryString", () => {
  it("keeps only what differs from the defaults and what the tab uses", () => {
    expect(dashboardQueryString(parseDashboardQuery({}))).toBe("");
    expect(
      dashboardQueryString({
        tab: "assets",
        asset: "offers",
        q: "trix",
        range: "30d",
        countries: ["ES"],
        threshold: 5,
      }),
    ).toBe("?tab=assets&range=30d&country=ES&asset=offers&q=trix");
    expect(dashboardQueryString({ tab: "contacts", threshold: 5, listsPage: 2 })).toBe(
      "?tab=contacts&threshold=5&lists=2",
    );
    expect(dashboardQueryString({ tab: "roi", range: "custom", from: "2026-10-01" })).toBe(
      "?tab=roi&range=custom&from=2026-10-01",
    );
  });
});

describe("dashboardWindow / describeWindow", () => {
  it("is open for all time and bounded for the presets and custom days", () => {
    const base = parseDashboardQuery({});
    expect(dashboardWindow(base, NOW)).toEqual({});
    expect(dashboardWindow({ ...base, range: "30d" }, NOW)).toEqual({
      from: new Date("2026-10-09T00:00:00Z"),
      to: new Date("2026-11-08T00:00:00Z"),
    });
    expect(dashboardWindow({ ...base, range: "90d" }, NOW).from).toEqual(
      new Date("2026-08-10T00:00:00Z"),
    );
    expect(
      dashboardWindow({ ...base, range: "custom", from: "2026-10-01", to: "2026-10-31" }, NOW),
    ).toEqual({
      from: new Date("2026-10-01T00:00:00Z"),
      to: new Date("2026-11-01T00:00:00Z"),
    });
    expect(describeWindow(base, NOW)).toBe("all time");
    expect(describeWindow({ ...base, range: "30d" }, NOW)).toBe(
      "2026-10-09 → 2026-11-07 (last 30 days)",
    );
    expect(describeWindow({ ...base, range: "custom", from: "2026-10-01" }, NOW)).toBe(
      "2026-10-01 → …",
    );
  });
});
