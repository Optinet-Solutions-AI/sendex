import { describe, expect, it } from "vitest";
import { authMode, devAuthConfig, isClerkConfigured, missingClerkEnv } from "./env";

const clerkKeys = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x", CLERK_SECRET_KEY: "sk_test_y" };

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
    expect(missingClerkEnv(clerkKeys)).toEqual([]);
    expect(isClerkConfigured(clerkKeys)).toBe(true);
    expect(isClerkConfigured({})).toBe(false);
  });
});

describe("authMode", () => {
  it("is clerk when both keys are set, whatever SENDEX_DEV_AUTH says", () => {
    expect(authMode({ ...clerkKeys, NODE_ENV: "development" })).toBe("clerk");
    expect(authMode({ ...clerkKeys, NODE_ENV: "development", SENDEX_DEV_AUTH: "1" })).toBe("clerk");
    expect(authMode({ ...clerkKeys, NODE_ENV: "production", SENDEX_DEV_AUTH: "1" })).toBe("clerk");
  });

  it("is dev when SENDEX_DEV_AUTH=1, the keys are missing and NODE_ENV is not production", () => {
    expect(authMode({ NODE_ENV: "development", SENDEX_DEV_AUTH: "1" })).toBe("dev");
    expect(authMode({ NODE_ENV: "test", SENDEX_DEV_AUTH: "1" })).toBe("dev");
    expect(authMode({ SENDEX_DEV_AUTH: "1" })).toBe("dev");
  });

  it("is unconfigured when neither the keys nor the stub are set", () => {
    expect(authMode({})).toBe("unconfigured");
    expect(authMode({ NODE_ENV: "development" })).toBe("unconfigured");
    expect(authMode({ NODE_ENV: "development", SENDEX_DEV_AUTH: "" })).toBe("unconfigured");
  });

  it("only accepts the literal value 1 for SENDEX_DEV_AUTH", () => {
    expect(authMode({ NODE_ENV: "development", SENDEX_DEV_AUTH: "true" })).toBe("unconfigured");
    expect(authMode({ NODE_ENV: "development", SENDEX_DEV_AUTH: "0" })).toBe("unconfigured");
    expect(authMode({ NODE_ENV: "development", SENDEX_DEV_AUTH: "yes" })).toBe("unconfigured");
  });

  it("can never be dev in production, even with SENDEX_DEV_AUTH=1", () => {
    expect(authMode({ NODE_ENV: "production", SENDEX_DEV_AUTH: "1" })).toBe("unconfigured");
    expect(
      authMode({ NODE_ENV: "production", SENDEX_DEV_AUTH: "1", SENDEX_DEV_ORG_SLUG: "external" }),
    ).toBe("unconfigured");
  });

  it("reads process.env by default", () => {
    // Vitest sets NODE_ENV=test and the suite does not set Clerk keys or the stub flag.
    expect(["dev", "unconfigured"]).toContain(authMode());
  });
});

describe("devAuthConfig", () => {
  it("defaults to the external organisation as owner", () => {
    expect(devAuthConfig({})).toEqual({ orgSlug: "external", role: "owner" });
  });

  it("reads SENDEX_DEV_ORG_SLUG and SENDEX_DEV_ROLE", () => {
    expect(devAuthConfig({ SENDEX_DEV_ORG_SLUG: "internal", SENDEX_DEV_ROLE: "viewer" })).toEqual({
      orgSlug: "internal",
      role: "viewer",
    });
  });

  it("ignores blank values", () => {
    expect(devAuthConfig({ SENDEX_DEV_ORG_SLUG: "  ", SENDEX_DEV_ROLE: "" })).toEqual({
      orgSlug: "external",
      role: "owner",
    });
  });

  it("rejects a role that is not in the permissions matrix", () => {
    expect(() => devAuthConfig({ SENDEX_DEV_ROLE: "admin" })).toThrow(
      /SENDEX_DEV_ROLE.*admin.*owner, campaign_manager, viewer/,
    );
  });

  it("rejects a slug that is not safe to use in identifiers", () => {
    expect(() => devAuthConfig({ SENDEX_DEV_ORG_SLUG: "Not A Slug!" })).toThrow(
      /SENDEX_DEV_ORG_SLUG/,
    );
  });
});
