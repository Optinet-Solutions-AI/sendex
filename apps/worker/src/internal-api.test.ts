import type { CampaignLapRow } from "@sendex/db";
import { describe, expect, it } from "vitest";
import { createInternalApi, type InternalApiDeps } from "./internal-api.js";
import { createLogger } from "./log.js";
import { createProgressTracker } from "./send/progress.js";
import { fakeRedis } from "./send/redis.fake.js";

const quiet = createLogger({ write: () => undefined });

interface FakeOptions {
  laps?: CampaignLapRow[];
}

/** `secret: null` builds deps for a worker without INTERNAL_API_SECRET. */
function deps(options: FakeOptions = {}, secret: string | null = "s3cret") {
  const redis = fakeRedis();
  const d: InternalApiDeps = {
    secret: secret ?? undefined,
    log: quiet,
    progress: createProgressTracker(redis),
    store: {
      async listCampaignLaps(organisationId) {
        return organisationId === "org-1" ? (options.laps ?? []) : [];
      },
    },
  };
  return { deps: d, redis };
}

const auth = { "x-internal-secret": "s3cret" };

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
