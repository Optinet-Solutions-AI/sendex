import { listSuppressions } from "@sendex/db";
import { createTestDb, type TestDb } from "@sendex/db/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTrackedMessage, type TrackedMessageSeed } from "../links/test-seed.js";
import { createUnsubscribeRoutes } from "./routes.js";

let t: TestDb;
let seed: TrackedMessageSeed;

beforeAll(async () => {
  t = await createTestDb();
  seed = await seedTrackedMessage(t.db);
});

afterAll(async () => {
  await t.close();
});

const log = () => undefined;

describe("GET /unsubscribe/:orgKey", () => {
  it("rm-fk suppresses the contact behind a dynamic id", async () => {
    const app = createUnsubscribeRoutes({ db: t.db, log });
    const res = await app.request(
      `/unsubscribe/${seed.organisationId}?type=rm-fk&fk=${encodeURIComponent(seed.dynamicId)}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, unsubscribed: true, added: true });
    const page = await listSuppressions(t.db, seed.organisationId, { page: 1, pageSize: 10 });
    expect(page.rows.map((r) => [r.e164, r.source])).toEqual([["+34600000001", "api"]]);

    const unknown = await app.request(`/unsubscribe/${seed.organisationId}?type=rm-fk&fk=nope`);
    expect(await unknown.json()).toEqual({ ok: true, unsubscribed: false, added: false });
  });

  it("rm-u suppresses a number in international format, by GET or POST", async () => {
    const app = createUnsubscribeRoutes({ db: t.db, log });
    const res = await app.request(
      `/unsubscribe/${seed.organisationId}?type=rm-u&number=${encodeURIComponent("+44 7911 123456")}`,
    );
    expect(await res.json()).toEqual({ ok: true, unsubscribed: true, added: true });
    const again = await app.request(`/unsubscribe/${seed.organisationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "rm-u", number: "447911123456" }),
    });
    expect(await again.json()).toEqual({ ok: true, unsubscribed: true, added: false });
    const bad = await app.request(`/unsubscribe/${seed.organisationId}?type=rm-u&number=12`);
    expect(bad.status).toBe(400);
  });

  it("refuses unknown organisations, unknown types and a tripped rate limit", async () => {
    const app = createUnsubscribeRoutes({ db: t.db, log, rateLimit: async () => false });
    expect((await app.request("/unsubscribe/nobody?type=rm-u&number=%2B34622000001")).status).toBe(
      404,
    );
    expect(
      (await app.request(`/unsubscribe/${seed.organisationId}?type=rm-u&number=1`)).status,
    ).toBe(429);
    const open = createUnsubscribeRoutes({ db: t.db, log });
    expect((await open.request(`/unsubscribe/${seed.organisationId}?type=what`)).status).toBe(400);
  });
});
