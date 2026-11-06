import { describe, expect, it } from "vitest";
import { auditQueryString, parseAuditQuery, summariseDetails } from "./audit-params";

describe("parseAuditQuery", () => {
  it("defaults to no filters on page one", () => {
    expect(parseAuditQuery({})).toEqual({ action: "", actor: "", from: "", to: "", page: 1 });
  });

  it("keeps a dotted action, a uuid actor, ISO dates and the page", () => {
    const actor = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    expect(
      parseAuditQuery({
        action: "balance.deposit",
        actor,
        from: "2026-11-01",
        to: "2026-11-06",
        page: "2",
      }),
    ).toEqual({ action: "balance.deposit", actor, from: "2026-11-01", to: "2026-11-06", page: 2 });
  });

  it("drops junk actions, non-uuid actors and bad dates", () => {
    expect(
      parseAuditQuery({ action: "drop table;", actor: "bob", from: "yesterday", page: "-1" }),
    ).toEqual({ action: "", actor: "", from: "", to: "", page: 1 });
  });
});

describe("auditQueryString", () => {
  it("leaves defaults out", () => {
    expect(auditQueryString({ action: "", actor: "", from: "", to: "", page: 1 })).toBe("");
    expect(auditQueryString({ action: "list.flush", page: 3 })).toBe("?action=list.flush&page=3");
  });
});

describe("summariseDetails", () => {
  it("renders a compact key=value summary and skips nested blobs", () => {
    expect(summariseDetails(null)).toBe("");
    expect(summariseDetails({ amountMicro: "25000000", method: "manual", note: null })).toBe(
      "amountMicro=25000000 method=manual note=null",
    );
    expect(summariseDetails({ lists: 6, nested: { a: 1 }, flags: [1, 2] })).toBe(
      "lists=6 nested={…} flags=[2]",
    );
  });

  it("truncates long values", () => {
    const summary = summariseDetails({ name: "x".repeat(200) });
    expect(summary.length).toBeLessThan(120);
    expect(summary.endsWith("…")).toBe(true);
  });
});
