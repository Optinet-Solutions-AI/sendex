import { describe, expect, it } from "vitest";
import {
  describeRouteRange,
  parseRoutesQuery,
  routesQueryString,
  routesWindow,
} from "./routes-params";

const NOW = new Date("2026-11-07T12:00:00Z");

describe("parseRoutesQuery / routesQueryString", () => {
  it("defaults to all time, every country, the Routes tab, page 1", () => {
    expect(parseRoutesQuery({})).toEqual({
      countries: [],
      routes: [],
      q: "",
      range: "all",
      from: "",
      to: "",
      tab: "routes",
      showRemoved: false,
      singlesOnly: false,
      showLow: false,
      page: 1,
    });
    expect(parseRoutesQuery({}, "30d").range).toBe("30d");
  });

  it("reads every field, dropping malformed values, and round-trips", () => {
    const query = parseRoutesQuery({
      country: ["es", "zzz"],
      route: ["0f1d6c62-6f5a-4a2a-9a1b-1c2d3e4f5a6b", "nope"],
      q: " orange ",
      range: "custom",
      from: "2026-10-01",
      to: "x",
      tab: "stats",
      removed: "1",
      singles: "true",
      low: "on",
      page: "3",
    });
    expect(query).toMatchObject({
      countries: ["ES"],
      routes: ["0f1d6c62-6f5a-4a2a-9a1b-1c2d3e4f5a6b"],
      q: "orange",
      range: "custom",
      from: "2026-10-01",
      to: "",
      tab: "stats",
      showRemoved: true,
      singlesOnly: true,
      showLow: true,
      page: 3,
    });
    expect(routesQueryString(query)).toBe(
      "?country=ES&route=0f1d6c62-6f5a-4a2a-9a1b-1c2d3e4f5a6b&q=orange&range=custom&from=2026-10-01&tab=stats&removed=1&singles=1&low=1&page=3",
    );
    expect(routesQueryString({ range: "30d" }, "30d")).toBe("");
  });
});

describe("routesWindow / describeRouteRange", () => {
  it("bounds the presets and custom days, open for all time", () => {
    const base = parseRoutesQuery({});
    expect(routesWindow(base, NOW)).toEqual({});
    expect(routesWindow({ ...base, range: "7d" }, NOW)).toEqual({
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-11-08T00:00:00Z"),
    });
    expect(
      routesWindow({ ...base, range: "custom", from: "2026-10-01", to: "2026-10-31" }, NOW),
    ).toEqual({
      from: new Date("2026-10-01T00:00:00Z"),
      to: new Date("2026-11-01T00:00:00Z"),
    });
    expect(describeRouteRange(base)).toBe("All time");
    expect(describeRouteRange({ ...base, range: "90d" })).toBe("Last 90 days");
    expect(describeRouteRange({ ...base, range: "custom", from: "2026-10-01" })).toBe(
      "2026-10-01 → …",
    );
  });
});
