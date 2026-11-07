import { describe, expect, it } from "vitest";
import { listsQueryString, parseListsQuery } from "./lists-params";

describe("parseListsQuery", () => {
  it("defaults to newest first, page 1, no filters", () => {
    expect(parseListsQuery({})).toEqual({
      search: "",
      countries: [],
      archived: false,
      sort: "createdAt",
      dir: "desc",
      page: 1,
    });
  });

  it("reads every parameter and normalises the country", () => {
    expect(
      parseListsQuery({
        search: " roy ",
        country: "es",
        sort: "numbersCount",
        dir: "asc",
        page: "3",
      }),
    ).toEqual({
      search: "roy",
      countries: ["ES"],
      archived: false,
      sort: "numbersCount",
      dir: "asc",
      page: 3,
    });
    expect(parseListsQuery({ country: ["es", "FR", "zzz"], archived: "1" })).toMatchObject({
      countries: ["ES", "FR"],
      archived: true,
    });
  });

  it("ignores unknown sort keys, bad directions and bad pages", () => {
    expect(parseListsQuery({ sort: "drop table", dir: "sideways", page: "-2" })).toMatchObject({
      sort: "createdAt",
      dir: "desc",
      page: 1,
    });
    expect(parseListsQuery({ page: ["7", "8"] }).page).toBe(7);
  });
});

describe("listsQueryString", () => {
  it("omits defaults", () => {
    expect(listsQueryString({ sort: "createdAt", dir: "desc", page: 1 })).toBe("");
  });

  it("includes what differs from the defaults", () => {
    expect(
      listsQueryString({ search: "roy boy", countries: ["ES"], sort: "name", dir: "asc", page: 2 }),
    ).toBe("?search=roy+boy&country=ES&sort=name&dir=asc&page=2");
  });
});
