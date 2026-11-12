import { deriveEventKey, derivePostbackToken, signPostbackQuery } from "@sendex/core";
import { getOrCreatePostbackKey, insertPostback } from "@sendex/db";
import { createTestDb, type TestDb } from "@sendex/db/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTrackedMessage, type TrackedMessageSeed } from "../links/test-seed.js";
import type { PostbackIngestPayload } from "./ingest.js";
import { createPostbackRoutes } from "./routes.js";

let t: TestDb;
let seed: TrackedMessageSeed;
let secret: string;

beforeAll(async () => {
  t = await createTestDb();
  seed = await seedTrackedMessage(t.db);
  secret = (await getOrCreatePostbackKey(t.db, seed.organisationId)).secret;
});

afterAll(async () => {
  await t.close();
});

type LogLine = { level: string; msg: string; fields: Record<string, unknown> };

function build(
  overrides: {
    enqueue?: (job: PostbackIngestPayload) => Promise<unknown>;
    rateLimit?: (key: string) => Promise<boolean>;
  } = {},
) {
  const enqueued: PostbackIngestPayload[] = [];
  const lines: LogLine[] = [];
  const app = createPostbackRoutes({
    db: t.db,
    enqueue:
      overrides.enqueue ??
      (async (job) => {
        enqueued.push(job);
      }),
    ...(overrides.rateLimit ? { rateLimit: overrides.rateLimit } : {}),
    log: (level, msg, fields = {}) => {
      lines.push({ level, msg, fields });
    },
  });
  return { app, enqueued, lines };
}

async function signedQuery(params: Record<string, string>, withSecret = secret): Promise<string> {
  const query = new URLSearchParams(params);
  query.set("sig", await signPostbackQuery(params, withSecret));
  return query.toString();
}

describe("GET /postback/:orgKey", () => {
  it("accepts a signed lead by organisation slug and enqueues the ingest job", async () => {
    const { app, enqueued } = build();
    const params = { type: "lead", dynamic_id: seed.dynamicId, sub_id: "abc" };
    const res = await app.request(`/postback/org-abcdefgh?${await signedQuery(params)}`);
    expect(res.status).toBe(202);
    const eventKey = await deriveEventKey({
      organisationId: seed.organisationId,
      type: "lead",
      dynamicId: seed.dynamicId,
    });
    expect(await res.json()).toEqual({ accepted: true, eventKey });
    expect(enqueued).toEqual([
      {
        organisationId: seed.organisationId,
        eventKey,
        type: "registration",
        dynamicId: seed.dynamicId,
        params,
      },
    ]);
  });

  it("accepts the organisation id, type aliases and a decimal value", async () => {
    const { app, enqueued } = build();
    const params = { type: "FTD", dynamic_id: seed.dynamicId, value: "12.50", event_key: "e-9" };
    const res = await app.request(`/postback/${seed.organisationId}?${await signedQuery(params)}`);
    expect(res.status).toBe(202);
    expect(enqueued[0]).toMatchObject({
      type: "sale",
      valueMicro: 12_500_000,
      eventKey: await deriveEventKey({
        organisationId: seed.organisationId,
        type: "sale",
        dynamicId: seed.dynamicId,
        clientEventKey: "e-9",
      }),
    });
  });

  it("rejects a bad, missing or foreign signature with 401 and counts it in the log", async () => {
    const { app, enqueued, lines } = build();
    const params = { type: "lead", dynamic_id: seed.dynamicId };
    const wrong = await app.request(`/postback/org-abcdefgh?${await signedQuery(params, "nope")}`);
    expect(wrong.status).toBe(401);
    const missing = await app.request(`/postback/org-abcdefgh?type=lead&dynamic_id=x`);
    expect(missing.status).toBe(401);
    const tampered = new URLSearchParams(await signedQuery(params));
    tampered.set("type", "sale");
    expect((await app.request(`/postback/org-abcdefgh?${tampered}`)).status).toBe(401);
    expect(enqueued).toHaveLength(0);
    const rejected = lines.filter((l) => l.msg === "postback signature rejected");
    expect(rejected).toHaveLength(3);
    expect(rejected[2]?.fields).toMatchObject({ organisationId: seed.organisationId, rejected: 3 });
  });

  it("answers 404 for an unknown organisation", async () => {
    const { app } = build();
    const res = await app.request(
      `/postback/nobody?${await signedQuery({ type: "lead", dynamic_id: "x" })}`,
    );
    expect(res.status).toBe(404);
  });

  it("answers 400 for invalid parameters once the signature checks out", async () => {
    const { app, enqueued } = build();
    const res = await app.request(
      `/postback/org-abcdefgh?${await signedQuery({ type: "click", dynamic_id: seed.dynamicId })}`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("type") });
    const noDyn = await app.request(
      `/postback/org-abcdefgh?${await signedQuery({ type: "lead" })}`,
    );
    expect(noDyn.status).toBe(400);
    expect(enqueued).toHaveLength(0);
  });

  it("answers 200 duplicate for an event that is already stored, without enqueueing", async () => {
    const { app, enqueued } = build();
    const eventKey = await deriveEventKey({
      organisationId: seed.organisationId,
      type: "lead",
      dynamicId: "dup-1",
    });
    await insertPostback(t.db, seed.organisationId, {
      eventKey,
      type: "lead",
      dynamicId: "dup-1",
      valueMicro: null,
      params: {},
    });
    const res = await app.request(
      `/postback/org-abcdefgh?${await signedQuery({ type: "lead", dynamic_id: "dup-1" })}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ duplicate: true, eventKey });
    expect(enqueued).toHaveLength(0);
  });

  it("answers 503 when the queue is unavailable and 429 when rate limited", async () => {
    const down = build({
      enqueue: async () => {
        throw new Error("redis down");
      },
    });
    const query = await signedQuery({ type: "lead", dynamic_id: seed.dynamicId });
    expect((await down.app.request(`/postback/org-abcdefgh?${query}`)).status).toBe(503);

    const limited = build({ rateLimit: async () => false });
    expect((await limited.app.request(`/postback/org-abcdefgh?${query}`)).status).toBe(429);
    expect(limited.enqueued).toHaveLength(0);
  });
});

describe("POST /postback/:orgKey", () => {
  it("reads the parameters from a JSON body", async () => {
    const { app, enqueued } = build();
    const params = { type: "sale", dynamic_id: seed.dynamicId, value: "3" };
    const res = await app.request("/postback/org-abcdefgh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...params, sig: await signPostbackQuery(params, secret) }),
    });
    expect(res.status).toBe(202);
    expect(enqueued[0]).toMatchObject({ type: "sale", valueMicro: 3_000_000, params });
  });

  it("reads the parameters from a form body", async () => {
    const { app, enqueued } = build();
    const params = { type: "lead", dynamic_id: seed.dynamicId };
    const res = await app.request("/postback/org-abcdefgh", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: await signedQuery(params),
    });
    expect(res.status).toBe(202);
    expect(enqueued[0]).toMatchObject({ type: "registration", params });
  });

  it("answers 400 for a body that is not JSON", async () => {
    const { app } = build();
    const res = await app.request("/postback/org-abcdefgh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
  });
});

// D4-11: the plain URL for trackers that cannot sign, like SMS Edge's `postback.php`.
describe("GET /postback/:orgKey/:token (simple URL)", () => {
  it("accepts a lead with SMS Edge's `key` and no signature", async () => {
    const { app, enqueued } = build();
    const token = await derivePostbackToken(secret);
    const res = await app.request(
      `/postback/org-abcdefgh/${token}?type=lead&key=${seed.dynamicId}`,
    );
    expect(res.status).toBe(202);
    const eventKey = await deriveEventKey({
      organisationId: seed.organisationId,
      type: "lead",
      dynamicId: seed.dynamicId,
    });
    expect(await res.json()).toEqual({ accepted: true, eventKey });
    expect(enqueued).toEqual([
      {
        organisationId: seed.organisationId,
        eventKey,
        type: "registration",
        dynamicId: seed.dynamicId,
        params: { type: "lead", key: seed.dynamicId },
      },
    ]);
  });

  it("accepts a sale with a value, by organisation id and with `dynamic_id`", async () => {
    const { app, enqueued } = build();
    const token = await derivePostbackToken(secret);
    const res = await app.request(
      `/postback/${seed.organisationId}/${token}?type=ftd&dynamic_id=${seed.dynamicId}&value=200`,
    );
    expect(res.status).toBe(202);
    expect(enqueued[0]).toMatchObject({ type: "sale", valueMicro: 200_000_000 });
  });

  it("gives the same event key as the signed URL, so a conversion never counts twice", async () => {
    const { app } = build();
    const token = await derivePostbackToken(secret);
    const simple = await app.request(`/postback/org-abcdefgh/${token}?type=lead&key=same-1`);
    const signed = await app.request(
      `/postback/org-abcdefgh?${await signedQuery({ type: "lead", dynamic_id: "same-1" })}`,
    );
    expect(((await simple.json()) as { eventKey: string }).eventKey).toBe(
      ((await signed.json()) as { eventKey: string }).eventKey,
    );
  });

  it("rejects a wrong, malformed or other organisation's token with 401", async () => {
    const { app, enqueued, lines } = build();
    const query = `type=lead&key=${seed.dynamicId}`;
    const other = await derivePostbackToken("another-secret");
    expect((await app.request(`/postback/org-abcdefgh/${other}?${query}`)).status).toBe(401);
    expect((await app.request(`/postback/org-abcdefgh/nope?${query}`)).status).toBe(401);
    // The secret itself is not a token.
    expect((await app.request(`/postback/org-abcdefgh/${secret}?${query}`)).status).toBe(401);
    expect(enqueued).toHaveLength(0);
    expect(lines.filter((l) => l.msg === "postback token rejected")).toHaveLength(3);
  });

  it("answers 400 for bad parameters, 404 for an unknown organisation and 429 when limited", async () => {
    const { app } = build();
    const token = await derivePostbackToken(secret);
    expect((await app.request(`/postback/org-abcdefgh/${token}?type=click&key=x`)).status).toBe(
      400,
    );
    expect((await app.request(`/postback/org-abcdefgh/${token}?type=lead`)).status).toBe(400);
    expect((await app.request(`/postback/nobody/${token}?type=lead&key=x`)).status).toBe(404);
    const limited = build({ rateLimit: async () => false });
    expect(
      (await limited.app.request(`/postback/org-abcdefgh/${token}?type=lead&key=x`)).status,
    ).toBe(429);
  });

  it("reads a POST form body too", async () => {
    const { app, enqueued } = build();
    const token = await derivePostbackToken(secret);
    const res = await app.request(`/postback/org-abcdefgh/${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `type=sale&key=${seed.dynamicId}`,
    });
    expect(res.status).toBe(202);
    expect(enqueued[0]).toMatchObject({ type: "sale", dynamicId: seed.dynamicId });
  });
});
