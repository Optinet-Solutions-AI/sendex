import { describe, expect, it } from "vitest";
import { followUpFilter, listFollowUpQueryString, parseListFollowUpQuery } from "./kpi-params";

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
