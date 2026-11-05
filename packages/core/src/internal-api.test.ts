import { describe, expect, it } from "vitest";
import { createLapRequestSchema } from "./internal-api.js";

const base = {
  organisationId: "org-1",
  campaignId: "cmp-1",
  listId: "list-1",
  routeId: "route-1",
};

describe("createLapRequestSchema", () => {
  it("accepts a finish request without a budget", () => {
    expect(createLapRequestSchema.parse({ ...base, mode: "finish" })).toEqual({
      ...base,
      mode: "finish",
    });
  });

  it("requires a positive integer budget for a budget request", () => {
    expect(createLapRequestSchema.safeParse({ ...base, mode: "budget" }).success).toBe(false);
    expect(
      createLapRequestSchema.safeParse({ ...base, mode: "budget", budgetMicro: 0 }).success,
    ).toBe(false);
    expect(
      createLapRequestSchema.safeParse({ ...base, mode: "budget", budgetMicro: 1.5 }).success,
    ).toBe(false);
    expect(
      createLapRequestSchema.parse({ ...base, mode: "budget", budgetMicro: 5_000_000 }),
    ).toEqual({ ...base, mode: "budget", budgetMicro: 5_000_000 });
  });

  it("rejects unknown modes and empty ids", () => {
    expect(createLapRequestSchema.safeParse({ ...base, mode: "all" }).success).toBe(false);
    expect(createLapRequestSchema.safeParse({ ...base, listId: "", mode: "finish" }).success).toBe(
      false,
    );
  });
});
