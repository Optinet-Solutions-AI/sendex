import { timingSafeEqual } from "node:crypto";
import type { SendingStore } from "@sendex/db";
import { Hono } from "hono";
import { z } from "zod";
import { log as defaultLog, type Logger } from "./log.js";
import type { ProgressTracker } from "./send/progress.js";

/**
 * `/internal/*`: endpoints the web app calls server-side (D2-06 progress).
 * Protected by a shared secret in `x-internal-secret` (`INTERNAL_API_SECRET`); without the
 * env the routes answer 503. Documented in docs/engineering/sending-engine.md.
 */

export const INTERNAL_SECRET_HEADER = "x-internal-secret";

export interface InternalApiDeps {
  /** `INTERNAL_API_SECRET`; undefined disables the routes. */
  secret: string | undefined;
  store: Pick<SendingStore, "listCampaignLaps">;
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

  return app;
}
