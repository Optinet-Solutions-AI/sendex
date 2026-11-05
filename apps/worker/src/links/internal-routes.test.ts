import { createTestDb, type TestDb } from "@sendex/db/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickBatch } from "./ingest.js";
import { createInternalLinksRoutes } from "./internal-routes.js";
import { seedTrackedMessage, type TrackedMessageSeed } from "./test-seed.js";

let t: TestDb;
let seed: TrackedMessageSeed;
let unlinked: TrackedMessageSeed;

const SECRET = "s3cret";
const AUTH = { "x-internal-secret": SECRET };

beforeAll(async () => {
  t = await createTestDb();
  seed = await seedTrackedMessage(t.db);
  unlinked = await seedTrackedMessage(t.db, { shortCode: "bcdefghj", withLink: false });
});

afterAll(async () => {
  await t.close();
});

function build(overrides: { secret?: string } = {}) {
  const enqueued: ClickBatch[] = [];
  const app = createInternalLinksRoutes({
    db: t.db,
    secret: overrides.secret ?? SECRET,
    enqueueClicks: async (batch) => {
      enqueued.push(batch);
    },
  });
  return { app, enqueued };
}

describe("authentication", () => {
  it("rejects a missing or wrong secret on both routes", async () => {
    const { app, enqueued } = build();
    expect((await app.request(`/internal/links/${seed.shortCode}`)).status).toBe(401);
    expect(
      (
        await app.request(`/internal/links/${seed.shortCode}`, {
          headers: { "x-internal-secret": "nope" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/internal/clicks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clicks: [] }),
        })
      ).status,
    ).toBe(401);
    expect(enqueued).toHaveLength(0);
  });

  it("refuses everything when no secret is configured", async () => {
    const { app } = build({ secret: "" });
    const res = await app.request(`/internal/links/${seed.shortCode}`, {
      headers: { "x-internal-secret": "" },
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /internal/links/:code", () => {
  it("returns the KV payload with the rendered destination", async () => {
    const { app } = build();
    const res = await app.request(`/internal/links/${seed.shortCode}`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      url: `https://dest.example/?d=${seed.dynamicId}&g=ES&c=${seed.campaignId}&l=${seed.listId}&r=23telecom&p=%2B34600000001`,
      organisationId: seed.organisationId,
      messageId: seed.messageId,
      campaignId: seed.campaignId,
      lapId: seed.lapId,
    });
  });

  it("returns 404 for an unknown, malformed or link-less code", async () => {
    const { app } = build();
    expect((await app.request("/internal/links/zzzzzzzz", { headers: AUTH })).status).toBe(404);
    expect((await app.request("/internal/links/not-a-code", { headers: AUTH })).status).toBe(404);
    expect(
      (await app.request(`/internal/links/${unlinked.shortCode}`, { headers: AUTH })).status,
    ).toBe(404);
  });
});

describe("POST /internal/clicks", () => {
  const click = {
    shortCode: "abcdefgh",
    clickedAt: "2026-11-06T10:00:00.000Z",
    ip: "203.0.113.9",
    userAgent: "ua",
    country: "ES",
    device: "mobile",
    asn: "Vodafone Spain",
  };

  it("validates the batch, enqueues it and answers 202", async () => {
    const { app, enqueued } = build();
    const res = await app.request("/internal/clicks", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ clicks: [click, { ...click, shortCode: "bcdefghj" }] }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 2 });
    expect(enqueued).toEqual([{ clicks: [click, { ...click, shortCode: "bcdefghj" }] }]);
  });

  it("answers 400 for an invalid body and enqueues nothing", async () => {
    const { app, enqueued } = build();
    const bad = await app.request("/internal/clicks", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ clicks: [{ shortCode: "abcdefgh" }] }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: expect.stringContaining("clickedAt") });
    const notJson = await app.request("/internal/clicks", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: "{",
    });
    expect(notJson.status).toBe(400);
    expect(enqueued).toHaveLength(0);
  });

  it("answers 503 when the queue is unavailable", async () => {
    const app = createInternalLinksRoutes({
      db: t.db,
      secret: SECRET,
      enqueueClicks: async () => {
        throw new Error("redis down");
      },
      log: () => {},
    });
    const res = await app.request("/internal/clicks", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ clicks: [click] }),
    });
    expect(res.status).toBe(503);
  });
});
