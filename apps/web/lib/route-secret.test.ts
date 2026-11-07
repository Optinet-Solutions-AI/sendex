import { describe, expect, it } from "vitest";
import { routeSecretKey } from "./route-secret";

describe("routeSecretKey", () => {
  it("uses the configured key, falls back to the dev key only under the dev auth stub", () => {
    const configured = "a".repeat(64);
    expect(routeSecretKey({ CUSTOM_ROUTE_SECRET_KEY: configured }).toString("hex")).toBe(
      configured,
    );
    expect(routeSecretKey({ SENDEX_DEV_AUTH: "1", NODE_ENV: "development" })).toHaveLength(32);
    expect(() => routeSecretKey({ NODE_ENV: "production", SENDEX_DEV_AUTH: "1" })).toThrow(
      /CUSTOM_ROUTE_SECRET_KEY is not set/,
    );
    expect(() => routeSecretKey({})).toThrow(/CUSTOM_ROUTE_SECRET_KEY is not set/);
  });
});
