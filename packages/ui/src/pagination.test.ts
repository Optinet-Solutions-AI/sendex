import { describe, expect, it } from "vitest";
import { pageWindow, paginationLabel } from "./pagination.js";

describe("paginationLabel", () => {
  it("formats the three SMS Edge styles", () => {
    expect(paginationLabel({ page: 1, pageSize: 25, total: 187, style: "page-of-total" })).toBe(
      "Page 1 of 8 (187 total)",
    );
    expect(paginationLabel({ page: 2, pageSize: 25, total: 131, style: "short" })).toBe("2 of 6");
    expect(paginationLabel({ page: 1, pageSize: 50, total: 72, style: "page-of" })).toBe(
      "Page 1 of 2",
    );
    expect(
      paginationLabel({ page: 1, pageSize: 25, total: 4339, style: "showing", noun: "contacts" }),
    ).toBe("Showing 1 - 25 of 4,339 contacts");
    expect(
      paginationLabel({ page: 174, pageSize: 25, total: 4339, style: "showing", noun: "contacts" }),
    ).toBe("Showing 4,326 - 4,339 of 4,339 contacts");
  });

  it("handles an empty result", () => {
    expect(
      paginationLabel({ page: 1, pageSize: 25, total: 0, style: "showing", noun: "items" }),
    ).toBe("Showing 0-0 of 0 items");
    expect(paginationLabel({ page: 1, pageSize: 25, total: 0, style: "page-of-total" })).toBe(
      "Page 1 of 1 (0 total)",
    );
    expect(paginationLabel({ page: 1, pageSize: 25, total: 0, style: "short" })).toBe("1 of 1");
  });
});

describe("pageWindow", () => {
  it("reports whether previous and next exist", () => {
    expect(pageWindow(1, 25, 187)).toEqual({ pageCount: 8, hasPrevious: false, hasNext: true });
    expect(pageWindow(8, 25, 187)).toEqual({ pageCount: 8, hasPrevious: true, hasNext: false });
    expect(pageWindow(1, 25, 0)).toEqual({ pageCount: 1, hasPrevious: false, hasNext: false });
  });
});
