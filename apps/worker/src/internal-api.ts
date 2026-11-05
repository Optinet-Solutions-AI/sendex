import { timingSafeEqual } from "node:crypto";
import { budgetPlan, createLapRequestSchema, finishListPlan } from "@sendex/core";
import type { SendingStore } from "@sendex/db";
import { Hono } from "hono";
import { z } from "zod";
import { log as defaultLog, type Logger } from "./log.js";
import type { ProgressTracker } from "./send/progress.js";

/**
 * `/internal/*`: endpoints the web app calls server-side (D2-06 progress, D2-07 laps).
 * Protected by a shared secret in `x-internal-secret` (`INTERNAL_API_SECRET`); without the
 * env the routes answer 503. Documented in docs/engineering/sending-engine.md.
 */

export const INTERNAL_SECRET_HEADER = "x-internal-secret";

export interface InternalApiDeps {
  /** `INTERNAL_API_SECRET`; undefined disables the routes. */
  secret: string | undefined;
  store: Pick<
    SendingStore,
    | "listCampaignLaps"
    | "loadLapPlanningContext"
    | "getCurrentPriceMicro"
    | "countEligibleMembers"
    | "createQueuedLap"
  >;
  progress: Pick<ProgressTracker, "readCampaign">;
  log?: Logger;
}

function secretMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const progressQuerySchema = z.object({ organisationId: z.string().min(1) });

export function createInternalApi(deps: InternalApiDeps): Hono {
  const log = deps.log ?? defaultLog;
  const app = new Hono();

  app.use("/internal/*", async (c, next) => {
    if (deps.secret === undefined || deps.secret === "") {
      return c.json({ error: "internal api disabled: INTERNAL_API_SECRET is not set" }, 503);
    }
    if (!secretMatches(deps.secret, c.req.header(INTERNAL_SECRET_HEADER))) {
      log("warn", "internal api: bad secret", { path: c.req.path });
      return c.json({ error: "unauthorised" }, 401);
    }
    await next();
  });

  app.get("/internal/progress/campaigns/:id", async (c) => {
    const query = progressQuerySchema.safeParse({ organisationId: c.req.query("organisationId") });
    if (!query.success) {
      return c.json({ error: "organisationId query parameter is required" }, 400);
    }
    const campaignId = c.req.param("id");
    const laps = await deps.store.listCampaignLaps(query.data.organisationId, campaignId);
    return c.json(await deps.progress.readCampaign(campaignId, laps));
  });

  /** Finish List (everything still eligible) or a budget lap (what the budget buys). */
  app.post("/internal/laps", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const parsed = createLapRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid request", issues: z.prettifyError(parsed.error) }, 400);
    }
    const req = parsed.data;
    const ctx = await deps.store.loadLapPlanningContext(req);
    if (!ctx.campaign) return c.json({ error: "campaign not found" }, 404);
    if (!ctx.list) return c.json({ error: "list not found" }, 404);
    if (!ctx.route) return c.json({ error: "route not found" }, 404);
    if (!ctx.route.active) return c.json({ error: "route is inactive" }, 422);
    const priceMicro = await deps.store.getCurrentPriceMicro(req.routeId, ctx.list.country);
    if (priceMicro === null) {
      return c.json({ error: `route has no price for ${ctx.list.country}` }, 422);
    }
    const available = await deps.store.countEligibleMembers({
      organisationId: req.organisationId,
      listId: req.listId,
      campaignId: req.campaignId,
      contactReuse: ctx.campaign.contactReuse,
    });
    const price = Number(priceMicro);
    const count =
      req.mode === "finish"
        ? finishListPlan({ available, routeId: req.routeId, priceMicro: price }).count
        : Math.min(budgetPlan({ budgetMicro: req.budgetMicro, priceMicro: price }), available);
    if (count === 0) {
      return c.json(
        { error: "nothing to send", available, priceMicro: priceMicro.toString() },
        422,
      );
    }
    const lap = await deps.store.createQueuedLap({
      organisationId: req.organisationId,
      campaignId: req.campaignId,
      listId: req.listId,
      routeId: req.routeId,
      testSize: count,
      details: {
        mode: req.mode,
        available,
        priceMicro: priceMicro.toString(),
        ...(req.mode === "budget" ? { budgetMicro: req.budgetMicro } : {}),
        source: "internal-api",
      },
    });
    log("info", "lap queued via internal api", {
      lapId: lap.id,
      campaignId: lap.campaignId,
      organisationId: lap.organisationId,
      mode: req.mode,
      count,
    });
    return c.json(
      {
        lap: { ...lap, costMicro: lap.costMicro.toString() },
        available,
        priceMicro: priceMicro.toString(),
        estimatedCostMicro: (BigInt(count) * priceMicro).toString(),
      },
      201,
    );
  });

  return app;
}
