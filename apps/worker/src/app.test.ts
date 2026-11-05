import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("GET /health", () => {
  it("returns 200 with component status when everything is up", async () => {
    const app = createApp({
      version: "test",
      checkRedis: async () => true,
      checkDatabase: async () => true,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "test", redis: true, database: true });
  });

  it("returns 503 when a dependency is down or throws", async () => {
    const app = createApp({
      version: "test",
      checkRedis: async () => {
        throw new Error("boom");
      },
      checkDatabase: async () => true,
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, redis: false, database: true });
  });
});
