import {
  addAdTexts,
  addSenderIds,
  adTexts,
  attachLink,
  auditLog,
  contacts,
  createApiToken,
  createCampaign,
  createLink,
  createSendingStore,
  createSidGroup,
  listMembers,
  lists,
  revokeApiToken,
  routePrices,
  routes,
  type SendingStore,
  setCampaignLists,
  setCampaignSidGroup,
} from "@sendex/db";
import { createTestDb, seedOrganisation, type TestDb } from "@sendex/db/test";
import { createFakeRedis, createRateLimiter, type RateLimitPreset } from "@sendex/redis-utils";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgressTracker, type SendRedis } from "../send/progress.js";
import { createPublicApi, type PublicApiDeps } from "./routes.js";

let t: TestDb;
let store: SendingStore;
let orgA: string;
let orgB: string;
let listEs: string;
let route405: string;
let route403: string;

/** The slice of Redis the progress tracker needs, in memory. */
function memoryRedis(): SendRedis {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, String(value));
    },
    async incrby(key, by) {
      const next = Number(map.get(key) ?? "0") + by;
      map.set(key, String(next));
      return next;
    },
    async mget(...keys) {
      return keys.map((k) => map.get(k) ?? null);
    },
    async expire() {
      return 1;
    },
  };
}

async function seedList(org: string, name: string, prefix: string, n: number): Promise<string> {
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name, country: "ES", numbersCount: n })
    .returning({ id: lists.id });
  if (!list) throw new Error("list insert failed");
  const rows = await t.db
    .insert(contacts)
    .values(
      Array.from({ length: n }, (_, i) => ({
        organisationId: org,
        e164: `${prefix}${String(100 + i)}`,
        country: "ES",
      })),
    )
    .returning({ id: contacts.id });
  await t.db
    .insert(listMembers)
    .values(rows.map((c) => ({ organisationId: org, listId: list.id, contactId: c.id })));
  return list.id;
}

async function seedRoute(name: string, priceMicro: bigint): Promise<string> {
  const [route] = await t.db
    .insert(routes)
    .values({ provider: "platform", name, country: "ES" })
    .returning({ id: routes.id });
  if (!route) throw new Error("route insert failed");
  await t.db
    .insert(routePrices)
    .values({ routeId: route.id, country: "ES", priceMicro, validFrom: new Date("2025-01-01") });
  return route.id;
}

/** A draft campaign of `org` with everything the send needs. */
async function seedSendableCampaign(org: string, name: string): Promise<string> {
  const campaign = await createCampaign(t.db, org, { name, country: "ES", timezone: "UTC" });
  const group = await createSidGroup(t.db, org, { name: `${name} SIDs`, country: "ES" });
  await addSenderIds(t.db, org, group.id, ["AAA111"]);
  await setCampaignSidGroup(t.db, org, campaign.id, group.id);
  await setCampaignLists(t.db, org, campaign.id, [listEs]);
  await addAdTexts(t.db, org, campaign.id, "Hello {{domain}}");
  const link = await createLink(t.db, org, { name: "L", url: "https://x.example/{{dynamic}}" });
  await attachLink(t.db, org, campaign.id, link.id);
  return campaign.id;
}

beforeAll(async () => {
  t = await createTestDb();
  store = createSendingStore(t.db);
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");
  listEs = await seedList(orgA, "ES list", "+34600", 5);
  route405 = await seedRoute("405", 25_000n);
  route403 = await seedRoute("403", 30_000n);
});

afterAll(async () => {
  await t.close();
});

function build(overrides: Partial<PublicApiDeps> = {}) {
  const progress = createProgressTracker(memoryRedis());
  const app = createPublicApi({
    db: t.db,
    store,
    progress,
    log: () => undefined,
    ...overrides,
  });
  return { app, progress };
}

async function token(org: string, scopes: Array<"read" | "write" | "send">): Promise<string> {
  const created = await createApiToken(t.db, org, { name: "t", scopes });
  return created.token;
}

function bearer(value: string): Record<string, string> {
  return { authorization: `Bearer ${value}` };
}

describe("authentication", () => {
  it("answers 401 without a bearer token, with a malformed one and with an unknown one", async () => {
    const { app } = build();
    const none = await app.request("/api/v1/campaigns");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
    expect(await none.json()).toEqual({ error: "unauthorised" });
    expect(
      (await app.request("/api/v1/campaigns", { headers: { authorization: "Basic x" } })).status,
    ).toBe(401);
    expect(
      (await app.request("/api/v1/campaigns", { headers: bearer("sdx_doesnotexist") })).status,
    ).toBe(401);
  });

  it("QA: a fresh token lists campaigns (200); once revoked it answers 401", async () => {
    const { app } = build();
    const created = await createApiToken(t.db, orgA, { name: "QA", scopes: ["read"] });
    const ok = await app.request("/api/v1/campaigns", { headers: bearer(created.token) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      items: expect.any(Array),
      page: 1,
      total: expect.any(Number),
    });

    await revokeApiToken(t.db, orgA, created.row.id);
    const gone = await app.request("/api/v1/campaigns", { headers: bearer(created.token) });
    expect(gone.status).toBe(401);
  });

  it("answers 403 when the token lacks the scope", async () => {
    const { app } = build();
    const readOnly = await token(orgA, ["read"]);
    const res = await app.request("/api/v1/campaigns", {
      method: "POST",
      headers: { ...bearer(readOnly), "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope", country: "ES" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", issues: "token lacks the write scope" });
  });

  it("GET /api/v1/me describes the token and its organisation", async () => {
    const { app } = build();
    const created = await createApiToken(t.db, orgA, { name: "Me", scopes: ["read", "send"] });
    const res = await app.request("/api/v1/me", { headers: bearer(created.token) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      organisation: { id: orgA, name: "org-a", slug: "org-a" },
      token: {
        id: created.row.id,
        name: "Me",
        prefix: created.row.prefix,
        scopes: ["read", "send"],
        createdAt: created.row.createdAt.toISOString(),
      },
    });
  });
});

describe("rate limiting", () => {
  it("answers 429 with RateLimit-* headers once the per-token window is used up", async () => {
    const preset: RateLimitPreset = { name: "publicApi", max: 2, windowMs: 60_000, scope: "token" };
    const limiter = createRateLimiter(createFakeRedis(), { prefix: "test:rl" });
    const { app } = build({ rateLimit: { limiter, preset } });
    const a = await token(orgA, ["read"]);
    const b = await token(orgA, ["read"]);

    const first = await app.request("/api/v1/me", { headers: bearer(a) });
    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-limit")).toBe("2");
    expect(first.headers.get("ratelimit-remaining")).toBe("1");
    expect((await app.request("/api/v1/me", { headers: bearer(a) })).status).toBe(200);

    const limited = await app.request("/api/v1/me", { headers: bearer(a) });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("ratelimit-remaining")).toBe("0");
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });

    // Another token of the same organisation has its own window.
    expect((await app.request("/api/v1/me", { headers: bearer(b) })).status).toBe(200);
    // An unauthenticated call never counts against anyone.
    expect((await app.request("/api/v1/me")).status).toBe(401);
  });
});

describe("lists", () => {
  it("lists and reads the organisation's lists, never another organisation's", async () => {
    const { app } = build();
    const a = await token(orgA, ["read"]);
    const page = await app.request("/api/v1/lists", { headers: bearer(a) });
    expect(page.status).toBe(200);
    const body = (await page.json()) as {
      items: Array<{ id: string; name: string }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      id: listEs,
      name: "ES list",
      country: "ES",
      numbersCount: 5,
    });

    const one = await app.request(`/api/v1/lists/${listEs}`, { headers: bearer(a) });
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({
      id: listEs,
      counts: { members: 5, available: 5, sent: 0, bad: 0 },
    });

    const b = await token(orgB, ["read"]);
    expect((await app.request(`/api/v1/lists/${listEs}`, { headers: bearer(b) })).status).toBe(404);
    const notUuid = await app.request("/api/v1/lists/not-a-uuid", { headers: bearer(a) });
    expect(notUuid.status).toBe(400);
    expect(await notUuid.json()).toMatchObject({ error: "validation_failed" });
  });
});

describe("campaigns", () => {
  it("creates a draft (write scope), audits it, reads it back with counters", async () => {
    const { app } = build();
    const created = await createApiToken(t.db, orgA, { name: "Writer", scopes: ["read", "write"] });
    const res = await app.request("/api/v1/campaigns", {
      method: "POST",
      headers: { ...bearer(created.token), "content-type": "application/json" },
      body: JSON.stringify({ name: "Via API", country: "es" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; timezone: string };
    expect(body).toMatchObject({
      name: "Via API",
      country: "ES",
      timezone: "Europe/Madrid",
      status: "draft",
      lists: [],
      laps: [],
      counters: { sent: 0, costMicro: "0" },
    });

    const audit = await t.db.select().from(auditLog).where(eq(auditLog.targetId, body.id));
    expect(audit.map((a) => a.action)).toEqual(["campaign.create"]);
    expect(audit[0]?.details).toMatchObject({ source: "api", tokenId: created.row.id });
    expect(audit[0]?.actorUserId).toBeNull();

    const detail = await app.request(`/api/v1/campaigns/${body.id}`, {
      headers: bearer(created.token),
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: body.id, name: "Via API" });

    const bad = await app.request("/api/v1/campaigns", {
      method: "POST",
      headers: { ...bearer(created.token), "content-type": "application/json" },
      body: JSON.stringify({ name: "", country: "Spain" }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "validation_failed" });
  });

  it("prices the send at the SMS parts of the text with the worker's real link length", async () => {
    const sender = await createApiToken(t.db, orgA, { name: "Parts", scopes: ["send"] });
    // 121 characters as typed: one part with a 20-character link, two with a 50-character one.
    const text = `${"a".repeat(120)} {{domain}}`;
    const send = async (deps: Partial<PublicApiDeps>, name: string) => {
      const campaignId = await seedSendableCampaign(orgA, name);
      await t.db.update(adTexts).set({ text }).where(eq(adTexts.campaignId, campaignId));
      const res = await build(deps).app.request(`/api/v1/campaigns/${campaignId}/send`, {
        method: "POST",
        headers: { ...bearer(sender.token), "content-type": "application/json" },
        body: JSON.stringify({ routeIds: [route405] }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { costMicro: string }).costMicro;
    };
    expect(await send({ linkLength: 20 }, "Short link")).toBe("125000");
    expect(await send({}, "Unknown link")).toBe("250000");
  });

  it("sends (send scope): estimate, queue the laps, audit, then report status with progress", async () => {
    const { app, progress } = build();
    const campaignId = await seedSendableCampaign(orgA, "Send via API");
    const sender = await createApiToken(t.db, orgA, { name: "Sender", scopes: ["read", "send"] });

    const res = await app.request(`/api/v1/campaigns/${campaignId}/send`, {
      method: "POST",
      headers: { ...bearer(sender.token), "content-type": "application/json" },
      body: JSON.stringify({ routeIds: [route405, route403] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      laps: Array<{ id: string; routeId: string; testSize: number; status: string }>;
    };
    // One test lap per list and route; testSize (200) is capped by the list's 5 contacts.
    expect(body).toMatchObject({
      campaignId,
      status: "sending",
      smsCount: 10,
      costMicro: "275000",
    });
    expect(body.laps.map((l) => [l.routeId, l.testSize, l.status])).toEqual([
      [route405, 5, "queued"],
      [route403, 5, "queued"],
    ]);

    const audit = await t.db.select().from(auditLog).where(eq(auditLog.targetId, campaignId));
    expect(audit.map((a) => a.action).sort()).toEqual(["api.campaign.send", "campaign.send"]);

    const lapId = body.laps[0]?.id ?? "";
    const otherLapId = body.laps[1]?.id ?? "";
    await progress.setLapTotal(campaignId, lapId, 5);
    await progress.recordBatch(campaignId, lapId, { sent: 3, failed: 1 });
    const status = await app.request(`/api/v1/campaigns/${campaignId}/status`, {
      headers: bearer(sender.token),
    });
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as {
      progress: { laps: Array<{ lapId: string }> };
    };
    expect(statusBody).toMatchObject({
      id: campaignId,
      status: "sending",
      progress: { sent: 3, failed: 1, total: 10 },
      counters: { sent: 0, delivered: 0, failed: 0, clicks: 0, leads: 0, sales: 0 },
    });
    // Laps queued in one transaction share created_at, so their order is by id: compare as a set.
    expect(statusBody.progress.laps).toHaveLength(2);
    expect(statusBody.progress.laps).toEqual(
      expect.arrayContaining([
        { lapId, status: "queued", sent: 3, failed: 1, total: 5 },
        { lapId: otherLapId, status: "queued", sent: 0, failed: 0, total: 5 },
      ]),
    );
  });

  it("answers 422 when the campaign is not ready to send, without auditing", async () => {
    const { app } = build();
    const campaign = await createCampaign(t.db, orgA, {
      name: "No text",
      country: "ES",
      timezone: "UTC",
    });
    await setCampaignLists(t.db, orgA, campaign.id, [listEs]);
    const sender = await token(orgA, ["send"]);
    const res = await app.request(`/api/v1/campaigns/${campaign.id}/send`, {
      method: "POST",
      headers: { ...bearer(sender), "content-type": "application/json" },
      body: JSON.stringify({ routeIds: [route405] }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Add at least one active ad text" });
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.targetId, campaign.id));
    expect(audit).toEqual([]);
  });

  it("refuses a send without a route and for another organisation's campaign", async () => {
    const { app } = build();
    const campaignId = await seedSendableCampaign(orgA, "Guarded");
    const sender = await token(orgA, ["send"]);
    const empty = await app.request(`/api/v1/campaigns/${campaignId}/send`, {
      method: "POST",
      headers: { ...bearer(sender), "content-type": "application/json" },
      body: JSON.stringify({ routeIds: [] }),
    });
    expect(empty.status).toBe(400);

    const other = await token(orgB, ["send"]);
    const foreign = await app.request(`/api/v1/campaigns/${campaignId}/send`, {
      method: "POST",
      headers: { ...bearer(other), "content-type": "application/json" },
      body: JSON.stringify({ routeIds: [route405] }),
    });
    expect(foreign.status).toBe(404);
  });
});

describe("documentation", () => {
  it("serves the OpenAPI document and the Scalar page without a token", async () => {
    const { app } = build({ serverUrl: "https://api.sendex.test" });
    const spec = await app.request("/api/openapi.json");
    expect(spec.status).toBe(200);
    const doc = (await spec.json()) as {
      openapi: string;
      servers: Array<{ url: string }>;
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "https://api.sendex.test" }]);
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/api/v1/campaigns",
      "/api/v1/campaigns/{id}",
      "/api/v1/campaigns/{id}/send",
      "/api/v1/campaigns/{id}/status",
      "/api/v1/lists",
      "/api/v1/lists/{id}",
      "/api/v1/me",
    ]);
    expect(doc.components.securitySchemes).toHaveProperty("bearerAuth");

    const docs = await app.request("/api/docs");
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
    expect(await docs.text()).toContain("/api/openapi.json");
  });
});
