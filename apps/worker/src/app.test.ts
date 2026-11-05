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

describe("GET /health queues", () => {
  it("includes queue depths when a getQueueDepths dep is provided", async () => {
    const app = createApp({
      version: "test",
      checkRedis: async () => true,
      checkDatabase: async () => true,
      getQueueDepths: async () => ({
        send: { waiting: 2, active: 1, failed: 0, delayed: 3 },
      }),
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      version: "test",
      redis: true,
      database: true,
      queues: { send: { waiting: 2, active: 1, failed: 0, delayed: 3 } },
    });
  });

  it("reports queues as null without failing health when depths cannot be read", async () => {
    const app = createApp({
      version: "test",
      checkRedis: async () => true,
      checkDatabase: async () => true,
      getQueueDepths: async () => {
        throw new Error("redis gone");
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, queues: null });
  });
});
