import { describe, expect, it } from "vitest";
import {
  parsePostbacksQuery,
  postbackDateBounds,
  postbacksQueryString,
  postbackTypeFilter,
} from "./postbacks-params";

describe("parsePostbacksQuery", () => {
  it("falls back to safe defaults", () => {
    expect(parsePostbacksQuery({})).toEqual({
      type: "all",
      range: "all",
      from: "",
      to: "",
      search: "",
      page: 1,
    });
    expect(
      parsePostbacksQuery({ type: "click", range: "yesterday", from: "nope", page: "-3" }),
    ).toMatchObject({ type: "all", range: "all", from: "", page: 1 });
  });

  it("reads every field, taking the first of repeated params", () => {
    expect(
      parsePostbacksQuery({
        type: ["sale", "lead"],
        range: "custom",
        from: "2026-11-01",
        to: "2026-11-06",
        search: "  abc ",
        page: "3",
      }),
    ).toEqual({
      type: "sale",
      range: "custom",
      from: "2026-11-01",
      to: "2026-11-06",
      search: "abc",
      page: 3,
    });
  });
});

describe("postbacksQueryString", () => {
  it("leaves defaults out and keeps custom dates only with the custom range", () => {
    expect(postbacksQueryString({ type: "all", range: "all", page: 1 })).toBe("");
    expect(
      postbacksQueryString({ type: "lead", range: "7d", from: "2026-11-01", search: "x", page: 2 }),
    ).toBe("?type=lead&range=7d&search=x&page=2");
    expect(postbacksQueryString({ range: "custom", from: "2026-11-01", to: "2026-11-06" })).toBe(
      "?range=custom&from=2026-11-01&to=2026-11-06",
    );
  });
});

describe("postbackDateBounds", () => {
  const now = new Date("2026-11-06T15:30:00.000Z");
  const base = { type: "all" as const, from: "", to: "", search: "", page: 1 };

  it("maps relative ranges to a UTC start of day", () => {
    expect(postbackDateBounds({ ...base, range: "all" }, now)).toEqual({});
    expect(postbackDateBounds({ ...base, range: "today" }, now)).toEqual({
      from: new Date("2026-11-06T00:00:00.000Z"),
    });
    expect(postbackDateBounds({ ...base, range: "7d" }, now)).toEqual({
      from: new Date("2026-10-31T00:00:00.000Z"),
    });
    expect(postbackDateBounds({ ...base, range: "30d" }, now)).toEqual({
      from: new Date("2026-10-08T00:00:00.000Z"),
    });
    expect(postbackDateBounds({ ...base, range: "90d" }, now)).toEqual({
      from: new Date("2026-08-09T00:00:00.000Z"),
    });
  });

  it("covers whole days for a custom range and leaves missing bounds open", () => {
    expect(
      postbackDateBounds({ ...base, range: "custom", from: "2026-11-01", to: "2026-11-02" }, now),
    ).toEqual({
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2026-11-02T23:59:59.999Z"),
    });
    expect(postbackDateBounds({ ...base, range: "custom", to: "2026-11-02" }, now)).toEqual({
      to: new Date("2026-11-02T23:59:59.999Z"),
    });
  });
});

describe("postbackTypeFilter", () => {
  it("is undefined for all and the type otherwise", () => {
    const base = { range: "all" as const, from: "", to: "", search: "", page: 1 };
    expect(postbackTypeFilter({ ...base, type: "all" })).toBeUndefined();
    expect(postbackTypeFilter({ ...base, type: "sale" })).toBe("sale");
  });
});
