import { describe, expect, it } from "vitest";
import { filterListsByName } from "./list-filter";

const lists = [
  { id: "1", name: "Roy Boy_UK_14092026_Batch2" },
  { id: "2", name: "Alex Test" },
  { id: "3", name: "UK_ZEN_9" },
];

describe("filterListsByName", () => {
  it("returns every list for a blank search", () => {
    expect(filterListsByName(lists, "")).toEqual(lists);
    expect(filterListsByName(lists, "   ")).toEqual(lists);
  });

  it("matches any part of the name, in any case", () => {
    expect(filterListsByName(lists, "alex").map((l) => l.id)).toEqual(["2"]);
    expect(filterListsByName(lists, " UK ").map((l) => l.id)).toEqual(["1", "3"]);
    expect(filterListsByName(lists, "batch2").map((l) => l.id)).toEqual(["1"]);
  });

  it("matches every word typed, in any order", () => {
    expect(filterListsByName(lists, "batch2 roy").map((l) => l.id)).toEqual(["1"]);
    expect(filterListsByName(lists, "roy zen")).toEqual([]);
  });

  it("returns nothing when no name matches", () => {
    expect(filterListsByName(lists, "spain")).toEqual([]);
  });
});
