import { describe, expect, it } from "vitest";
import { isClerkConfigured, missingClerkEnv } from "./env";

describe("missingClerkEnv", () => {
  it("reports both keys when nothing is set", () => {
    expect(missingClerkEnv({})).toEqual(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]);
  });

  it("treats blank values as missing", () => {
    expect(
      missingClerkEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "  " }),
    ).toEqual(["CLERK_SECRET_KEY"]);
  });

  it("is empty when both keys are present", () => {
    const env = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_y" };
    expect(missingClerkEnv(env)).toEqual([]);
    expect(isClerkConfigured(env)).toBe(true);
    expect(isClerkConfigured({})).toBe(false);
  });
});
