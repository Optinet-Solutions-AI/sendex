import { describe, expect, it } from "vitest";
import { roleFromClerk } from "./clerk-roles";

describe("roleFromClerk", () => {
  it("maps org:admin to owner", () => {
    expect(roleFromClerk("org:admin")).toBe("owner");
  });
  it("maps org:member to campaign_manager", () => {
    expect(roleFromClerk("org:member")).toBe("campaign_manager");
  });
  it("maps anything else to viewer", () => {
    expect(roleFromClerk("org:custom")).toBe("viewer");
    expect(roleFromClerk("admin")).toBe("viewer");
    expect(roleFromClerk(null)).toBe("viewer");
    expect(roleFromClerk(undefined)).toBe("viewer");
  });
});
