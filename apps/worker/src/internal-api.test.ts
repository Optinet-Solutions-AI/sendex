import type { CampaignLapRow, CreateQueuedLapInput, LapPlanningContext } from "@sendex/db";
import { createFakeRedis } from "@sendex/redis-utils";
import { describe, expect, it } from "vitest";
import { createInternalApi, type InternalApiDeps } from "./internal-api.js";
import { createLogger } from "./log.js";
import { createProgressTracker } from "./send/progress.js";
import { fakeRedis } from "./send/redis.fake.js";

const quiet = createLogger({ write: () => undefined });

interface FakeOptions {
  laps?: CampaignLapRow[];
  planning?: Partial<LapPlanningContext>;
  priceMicro?: bigint | null;
  available?: number;
}

/** `secret: null` builds deps for a worker without INTERNAL_API_SECRET. */
function deps(options: FakeOptions = {}, secret: string | null = "s3cret") {
  const created: CreateQueuedLapInput[] = [];
  const redis = fakeRedis();
  const planning: LapPlanningContext = {
    campaign: { id: "cmp-1", status: "sending", contactReuse: "account_wide" },
    list: { id: "list-1", country: "ES" },
    route: { id: "route-1", provider: "fake", active: true },
    ...options.planning,
  };
  const d: InternalApiDeps = {
    secret: secret ?? undefined,
    log: quiet,
    progress: createProgressTracker(redis),
    store: {
      async listCampaignLaps(organisationId) {
        return organisationId === "org-1" ? (options.laps ?? []) : [];
      },
      async loadLapPlanningContext() {
        return planning;
      },
      async getCurrentPriceMicro() {
        return options.priceMicro === undefined ? 25_000n : options.priceMicro;
      },
      async countEligibleMembers() {
        return options.available ?? 1000;
      },
      async createQueuedLap(input) {
        created.push(input);
        return {
          id: "lap-new",
          organisationId: input.organisationId,
          campaignId: input.campaignId,
          listId: input.listId,
          routeId: input.routeId,
          testSize: input.testSize,
          status: "queued",
          sent: 0,
          failed: 0,
          costMicro: 0n,
        };
      },
    },
  };
  return { deps: d, created, redis };
}

const auth = { "x-internal-secret": "s3cret" };

const lapBody = {
  organisationId: "org-1",
  campaignId: "cmp-1",
  listId: "list-1",
  routeId: "route-1",
};

describe("internal api auth", () => {
  it("answers 503 when no secret is configured", async () => {
    const app = createInternalApi(deps({}, null).deps);
    const res = await app.request("/internal/progress/campaigns/cmp-1?organisationId=org-1", {
      headers: auth,
    });
    expect(res.status).toBe(503);
  });

  it("rejects a missing or wrong secret", async () => {
    const app = createInternalApi(deps().deps);
    expect(
      (await app.request("/internal/progress/campaigns/cmp-1?organisationId=org-1")).status,
    ).toBe(401);
    const wrong = await app.request("/internal/progress/campaigns/cmp-1?organisationId=org-1", {
      headers: { "x-internal-secret": "nope" },
    });
    expect(wrong.status).toBe(401);
  });
});

describe("GET /internal/progress/campaigns/:id", () => {
  it("requires the organisation id", async () => {
    const app = createInternalApi(deps().deps);
    const res = await app.request("/internal/progress/campaigns/cmp-1", { headers: auth });
    expect(res.status).toBe(400);
  });

  it("returns live per-lap and per-campaign counters", async () => {
    const d = deps({
      laps: [
        { id: "L1", status: "sending", testSize: 100, sent: 10, failed: 0 },
        { id: "L2", status: "queued", testSize: 50, sent: 0, failed: 0 },
      ],
    });
    await createProgressTracker(d.redis).setLapTotal("cmp-1", "L1", 100);
    await createProgressTracker(d.redis).recordBatch("cmp-1", "L1", { sent: 45, failed: 5 });
    const app = createInternalApi(d.deps);
    const res = await app.request("/internal/progress/campaigns/cmp-1?organisationId=org-1", {
      headers: auth,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      campaignId: "cmp-1",
      sent: 45,
      failed: 5,
      total: 150,
      laps: [
        { lapId: "L1", status: "sending", sent: 45, failed: 5, total: 100 },
        { lapId: "L2", status: "queued", sent: 0, failed: 0, total: 50 },
      ],
    });
    // Another organisation sees nothing of this campaign.
    const other = await app.request("/internal/progress/campaigns/cmp-1?organisationId=org-2", {
      headers: auth,
    });
    expect(await other.json()).toMatchObject({ total: 0, laps: [] });
  });
});

describe("POST /internal/laps", () => {
  const post = (app: ReturnType<typeof createInternalApi>, body: unknown) =>
    app.request("/internal/laps", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("validates the body with the shared Zod schema", async () => {
    const app = createInternalApi(deps().deps);
    const res = await post(app, { ...lapBody, mode: "budget" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid request" });
    const notJson = await app.request("/internal/laps", {
      method: "POST",
      headers: auth,
      body: "nope",
    });
    expect(notJson.status).toBe(400);
  });

  it("queues a finish lap for every eligible member", async () => {
    const d = deps({ available: 321 });
    const res = await post(createInternalApi(d.deps), { ...lapBody, mode: "finish" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      lap: {
        id: "lap-new",
        ...lapBody,
        testSize: 321,
        status: "queued",
        sent: 0,
        failed: 0,
        costMicro: "0",
      },
      available: 321,
      priceMicro: "25000",
      estimatedCostMicro: String(321 * 25_000),
    });
    expect(d.created[0]).toMatchObject({
      testSize: 321,
      details: { mode: "finish", available: 321, priceMicro: "25000", source: "internal-api" },
    });
  });

  it("queues a budget lap capped by what the budget buys and what is available", async () => {
    const d = deps({ available: 1000 });
    const app = createInternalApi(d.deps);
    // EUR 5 at 0.025 = 200 messages.
    const res = await post(app, { ...lapBody, mode: "budget", budgetMicro: 5_000_000 });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      lap: { testSize: 200 },
      estimatedCostMicro: "5000000",
    });
    expect(d.created[0]?.details).toMatchObject({ mode: "budget", budgetMicro: 5_000_000 });

    const capped = deps({ available: 120 });
    const res2 = await post(createInternalApi(capped.deps), {
      ...lapBody,
      mode: "budget",
      budgetMicro: 5_000_000,
    });
    expect(await res2.json()).toMatchObject({ lap: { testSize: 120 } });
  });

  it("explains why a lap cannot be queued", async () => {
    const missing = await post(createInternalApi(deps({ planning: { campaign: null } }).deps), {
      ...lapBody,
      mode: "finish",
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "campaign not found" });

    const inactive = await post(
      createInternalApi(
        deps({ planning: { route: { id: "route-1", provider: "fake", active: false } } }).deps,
      ),
      { ...lapBody, mode: "finish" },
    );
    expect(inactive.status).toBe(422);

    const unpriced = await post(createInternalApi(deps({ priceMicro: null }).deps), {
      ...lapBody,
      mode: "finish",
    });
    expect(unpriced.status).toBe(422);
    expect(await unpriced.json()).toEqual({ error: "route has no price for ES" });

    const empty = await post(createInternalApi(deps({ available: 0 }).deps), {
      ...lapBody,
      mode: "finish",
    });
    expect(empty.status).toBe(422);
    expect(await empty.json()).toMatchObject({ error: "nothing to send", available: 0 });
  });
});

describe("/internal/emergency-stop (D2-09)", () => {
  function withFlags() {
    const flags = createFakeRedis();
    const d = deps();
    return { app: createInternalApi({ ...d.deps, redis: flags }), flags };
  }
  const json = { ...auth, "content-type": "application/json" };

  it("answers 503 when the worker has no Redis", async () => {
    const app = createInternalApi(deps().deps);
    const res = await app.request("/internal/emergency-stop?organisationId=org-1", {
      headers: auth,
    });
    expect(res.status).toBe(503);
  });

  it("reports not stopped, raises the flag, reports it, clears it", async () => {
    const { app, flags } = withFlags();
    const before = await app.request("/internal/emergency-stop?organisationId=org-1", {
      headers: auth,
    });
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ stopped: false, stop: null });

    const raised = await app.request("/internal/emergency-stop", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ organisationId: "org-1", reason: "bad link", byUserId: "u-1" }),
    });
    expect(raised.status).toBe(200);
    const body = (await raised.json()) as { stopped: boolean; stop: { stoppedAt: string } };
    expect(body).toMatchObject({ stopped: true, stop: { reason: "bad link", byUserId: "u-1" } });
    expect(typeof body.stop.stoppedAt).toBe("string");
    expect(await flags.get("sendex:stop:org-1")).not.toBeNull();
    expect(await flags.get("sendex:stop:org-2")).toBeNull();

    const during = await app.request("/internal/emergency-stop?organisationId=org-1", {
      headers: auth,
    });
    expect(await during.json()).toEqual({ stopped: true, stop: body.stop });

    const cleared = await app.request("/internal/emergency-stop?organisationId=org-1", {
      method: "DELETE",
      headers: auth,
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ stopped: false, stop: null, cleared: true });
    expect(await flags.get("sendex:stop:org-1")).toBeNull();

    const again = await app.request("/internal/emergency-stop?organisationId=org-1", {
      method: "DELETE",
      headers: auth,
    });
    expect(await again.json()).toEqual({ stopped: false, stop: null, cleared: false });
  });

  it("validates the body and the query", async () => {
    const { app } = withFlags();
    const noReason = await app.request("/internal/emergency-stop", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ organisationId: "org-1", reason: " ", byUserId: "u-1" }),
    });
    expect(noReason.status).toBe(400);
    const notJson = await app.request("/internal/emergency-stop", {
      method: "POST",
      headers: json,
      body: "nope",
    });
    expect(notJson.status).toBe(400);
    expect((await app.request("/internal/emergency-stop", { headers: auth })).status).toBe(400);
    expect(
      (await app.request("/internal/emergency-stop", { method: "DELETE", headers: auth })).status,
    ).toBe(400);
  });
});
