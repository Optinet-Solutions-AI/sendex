import { describe, expect, it } from "vitest";
import {
  followUpFilter,
  insightLabel,
  insightQueryString,
  insightWindow,
  listFollowUpQueryString,
  parseInsightQuery,
  parseListFollowUpQuery,
  parseSalesResultsQuery,
  salesResultsQueryString,
} from "./kpi-params";

const UUID = "0b8f5a2e-3c1d-4e6f-9a7b-1c2d3e4f5a6b";

describe("parseListFollowUpQuery", () => {
  it("is empty by default", () => {
    expect(parseListFollowUpQuery({})).toEqual({
      q: "",
      route: "",
      offer: "",
      countries: [],
      from: "",
      to: "",
    });
  });

  it("reads the search, the route, the offer, countries and days", () => {
    expect(
      parseListFollowUpQuery({
        q: "  zen ",
        route: UUID,
        offer: UUID,
        country: ["gb", "ES"],
        from: "2026-11-01",
        to: "2026-11-16",
      }),
    ).toEqual({
      q: "zen",
      route: UUID,
      offer: UUID,
      countries: ["GB", "ES"],
      from: "2026-11-01",
      to: "2026-11-16",
    });
  });

  it("drops ids and days that are not valid", () => {
    const query = parseListFollowUpQuery({ route: "405", offer: "x", from: "1/11/26", to: "soon" });
    expect(query).toMatchObject({ route: "", offer: "", from: "", to: "" });
  });
});

describe("listFollowUpQueryString", () => {
  it("is empty for the default view and round-trips the rest", () => {
    expect(listFollowUpQueryString(parseListFollowUpQuery({}))).toBe("");
    const query = parseListFollowUpQuery({
      q: "zen",
      route: UUID,
      country: ["GB", "ES"],
      from: "2026-11-01",
    });
    const text = listFollowUpQueryString(query);
    expect(text).toBe(`?q=zen&route=${UUID}&country=GB&country=ES&from=2026-11-01`);
    expect(parseListFollowUpQuery(Object.fromEntries(searchParams(text)))).toEqual(query);
  });
});

function searchParams(text: string): Array<[string, string | string[]]> {
  const params = new URLSearchParams(text);
  return [...new Set(params.keys())].map((key) => {
    const values = params.getAll(key);
    return [key, values.length > 1 ? values : (values[0] ?? "")];
  });
}

describe("followUpFilter", () => {
  it("turns whole days into a UTC window, end day included", () => {
    const filter = followUpFilter(
      parseListFollowUpQuery({ from: "2026-11-01", to: "2026-11-16", q: "zen", route: UUID }),
    );
    expect(filter.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(filter.to?.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(filter.search).toBe("zen");
    expect(filter.routeId).toBe(UUID);
    expect(filter.linkId).toBeUndefined();
  });

  it("has no window without days", () => {
    const filter = followUpFilter(parseListFollowUpQuery({}));
    expect(filter.from).toBeUndefined();
    expect(filter.to).toBeUndefined();
    expect(filter.countries).toEqual([]);
  });
});

describe("performance insight query", () => {
  const now = new Date("2026-11-16T12:00:00Z");

  it("defaults to the current month, sorted by ROI", () => {
    expect(parseInsightQuery({}, now)).toEqual({
      period: "month",
      year: 2026,
      month: 11,
      sort: "roi",
    });
  });

  it("reads the period, year, month and sort, and ignores nonsense", () => {
    expect(parseInsightQuery({ period: "year", year: "2025", sort: "sales" }, now)).toMatchObject({
      period: "year",
      year: 2025,
      sort: "sales",
    });
    expect(
      parseInsightQuery({ period: "week", year: "1999", month: "13", sort: "x" }, now),
    ).toEqual({ period: "month", year: 2026, month: 11, sort: "roi" });
  });

  it("writes only what the period needs", () => {
    expect(insightQueryString({ period: "month", year: 2026, month: 10, sort: "roi" })).toBe(
      "?year=2026&month=10",
    );
    expect(insightQueryString({ period: "year", year: 2025, month: 3, sort: "sales" })).toBe(
      "?period=year&year=2025&sort=sales",
    );
    expect(insightQueryString({ period: "all", year: 2026, month: 11, sort: "roi" })).toBe(
      "?period=all",
    );
  });

  it("turns the period into a UTC window and a label", () => {
    const month = insightWindow({ period: "month", year: 2026, month: 12 });
    expect(month.from?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(month.to?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    const year = insightWindow({ period: "year", year: 2026, month: 5 });
    expect(year.from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(year.to?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(insightWindow({ period: "all", year: 2026, month: 5 })).toEqual({});

    expect(insightLabel({ period: "month", year: 2026, month: 11 })).toBe("November 2026");
    expect(insightLabel({ period: "year", year: 2026, month: 11 })).toBe("2026");
    expect(insightLabel({ period: "all", year: 2026, month: 11 })).toBe("All time");
  });
});

describe("sales results query", () => {
  const now = new Date("2026-11-16T12:00:00Z");

  it("defaults to the current month, most sales first", () => {
    expect(parseSalesResultsQuery({}, now)).toEqual({
      period: "month",
      year: 2026,
      month: 11,
      sort: "sales",
    });
  });

  it("reads the sort and the period and round-trips them", () => {
    const query = parseSalesResultsQuery({ period: "all", sort: "revenue" }, now);
    expect(query).toMatchObject({ period: "all", sort: "revenue" });
    expect(salesResultsQueryString(query)).toBe("?period=all&sort=revenue");
    expect(parseSalesResultsQuery({ sort: "name" }, now).sort).toBe("sales");
    expect(salesResultsQueryString(parseSalesResultsQuery({ month: "10" }, now))).toBe(
      "?year=2026&month=10",
    );
  });
});
