import { describe, expect, it } from "vitest";
import { hasSecretKey, openSecret, sealSecret, secretKeyFromEnv } from "./secrets.js";

const HEX = "a".repeat(64);

describe("secrets", () => {
  it("reads a hex or base64 key and refuses a missing or short one", () => {
    expect(secretKeyFromEnv({ CUSTOM_ROUTE_SECRET_KEY: HEX })).toHaveLength(32);
    expect(
      secretKeyFromEnv({ CUSTOM_ROUTE_SECRET_KEY: Buffer.alloc(32, 7).toString("base64") }),
    ).toHaveLength(32);
    expect(() => secretKeyFromEnv({})).toThrow(/CUSTOM_ROUTE_SECRET_KEY is not set/);
    expect(() => secretKeyFromEnv({ CUSTOM_ROUTE_SECRET_KEY: "abc" })).toThrow(/32 bytes/);
    expect(hasSecretKey({})).toBe(false);
    expect(hasSecretKey({ CUSTOM_ROUTE_SECRET_KEY: HEX })).toBe(true);
  });

  it("round-trips a secret and refuses the wrong key or a tampered value", () => {
    const key = secretKeyFromEnv({ CUSTOM_ROUTE_SECRET_KEY: HEX });
    const sealed = sealSecret({ password: "s3cret", username: "u" }, key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("s3cret");
    expect(openSecret(sealed, key)).toEqual({ password: "s3cret", username: "u" });
    const other = secretKeyFromEnv({ CUSTOM_ROUTE_SECRET_KEY: "b".repeat(64) });
    expect(() => openSecret(sealed, other)).toThrow();
    const parts = sealed.split(".");
    const body = parts[3] ?? "";
    const flipped = `${body.slice(0, 2)}${body[2] === "A" ? "B" : "A"}${body.slice(3)}`;
    expect(() => openSecret([parts[0], parts[1], parts[2], flipped].join("."), key)).toThrow();
    expect(() => openSecret("nope", key)).toThrow(/unknown format/);
  });
});
