import { describe, expect, it } from "vitest";
import {
  API_TOKEN_PREFIX,
  apiCreateCampaignSchema,
  apiSendCampaignSchema,
  apiTokenScopeSchema,
  bearerToken,
  displayPrefix,
  generateApiToken,
  hashApiToken,
  newApiTokenSchema,
  tokenHasScope,
} from "./api-tokens.js";

describe("generateApiToken", () => {
  it("makes a prefixed, URL-safe token of 32 random bytes", () => {
    const token = generateApiToken();
    expect(token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    const body = token.slice(API_TOKEN_PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateApiToken()));
    expect(seen.size).toBe(50);
  });
});

describe("hashApiToken", () => {
  it("is sha-256 hex, deterministic and different per token", async () => {
    const token = `${API_TOKEN_PREFIX}abc`;
    const hash = await hashApiToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashApiToken(token)).toBe(hash);
    expect(await hashApiToken(`${API_TOKEN_PREFIX}abd`)).not.toBe(hash);
  });

  it("matches the known digest of a fixed string", async () => {
    expect(await hashApiToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("displayPrefix", () => {
  it("keeps the prefix plus the first eight characters of the body", () => {
    expect(displayPrefix(`${API_TOKEN_PREFIX}abcdefghijklmnop`)).toBe(
      `${API_TOKEN_PREFIX}abcdefgh`,
    );
  });
});

describe("bearerToken", () => {
  it("extracts the token from an Authorization header", () => {
    expect(bearerToken("Bearer sdx_abc")).toBe("sdx_abc");
    expect(bearerToken("bearer   sdx_abc ")).toBe("sdx_abc");
  });

  it("returns null for anything else", () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer sdx_abc def")).toBeNull();
  });
});

describe("tokenHasScope", () => {
  it("is plain membership: no scope implies another", () => {
    expect(tokenHasScope(["read"], "read")).toBe(true);
    expect(tokenHasScope(["read"], "write")).toBe(false);
    expect(tokenHasScope(["send"], "read")).toBe(false);
    expect(tokenHasScope(["read", "write", "send"], "send")).toBe(true);
    expect(tokenHasScope([], "read")).toBe(false);
  });
});

describe("schemas", () => {
  it("apiTokenScopeSchema accepts the three scopes only", () => {
    expect(apiTokenScopeSchema.safeParse("read").success).toBe(true);
    expect(apiTokenScopeSchema.safeParse("admin").success).toBe(false);
  });

  it("newApiTokenSchema trims the name, dedupes scopes and needs at least one", () => {
    const parsed = newApiTokenSchema.parse({ name: "  CI  ", scopes: ["read", "read", "send"] });
    expect(parsed).toEqual({ name: "CI", scopes: ["read", "send"] });
    expect(newApiTokenSchema.safeParse({ name: "x", scopes: [] }).success).toBe(false);
    expect(newApiTokenSchema.safeParse({ name: "", scopes: ["read"] }).success).toBe(false);
    expect(newApiTokenSchema.safeParse({ name: "a".repeat(61), scopes: ["read"] }).success).toBe(
      false,
    );
  });

  it("apiCreateCampaignSchema fills the timezone from the country when omitted", () => {
    expect(apiCreateCampaignSchema.parse({ name: "Spring", country: "es" })).toEqual({
      name: "Spring",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    expect(
      apiCreateCampaignSchema.parse({ name: "Spring", country: "ES", timezone: "UTC" }).timezone,
    ).toBe("UTC");
    expect(apiCreateCampaignSchema.safeParse({ name: "Spring", country: "Spain" }).success).toBe(
      false,
    );
  });

  it("apiSendCampaignSchema needs at least one route id and defaults sendAll to false", () => {
    const id = "6f1b0a5c-3d2e-4f10-9a8b-7c6d5e4f3a2b";
    expect(apiSendCampaignSchema.parse({ routeIds: [id] })).toEqual({
      routeIds: [id],
      sendAll: false,
    });
    expect(apiSendCampaignSchema.safeParse({ routeIds: [] }).success).toBe(false);
    expect(apiSendCampaignSchema.safeParse({ routeIds: ["nope"] }).success).toBe(false);
  });
});
