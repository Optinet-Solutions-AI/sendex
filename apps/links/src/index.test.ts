import { describe, expect, it } from "vitest";
import { app } from "./index.js";

describe("links service", () => {
  it("answers /health", async () => {
    const res = await app.request("/health", {}, { SENDEX_VERSION: "test" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "test" });
  });
  it("returns 404 for an unknown code until redirects exist", async () => {
    const res = await app.request("/abc12345", {}, { SENDEX_VERSION: "test" });
    expect(res.status).toBe(404);
  });
});
