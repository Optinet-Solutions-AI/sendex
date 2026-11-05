import { createHash, timingSafeEqual } from "node:crypto";
import { isValidShortCode, renderLinkUrl } from "@sendex/core";
import { type Db, findShortCodeTarget } from "@sendex/db";
import { Hono } from "hono";
import { z } from "zod";
import { log as defaultLog, type Logger } from "../log.js";
import { type ClickBatch, clickBatchSchema } from "./ingest.js";

export interface InternalLinksDeps {
  db: Db;
  /** `INTERNAL_API_SECRET`; an empty value refuses every request. */
  secret: string;
  /** Hand a validated batch to the click-ingest queue. */
  enqueueClicks: (batch: ClickBatch) => Promise<unknown>;
  log?: Logger;
}

/** The payload the links service caches in KV under `code:<shortCode>`. */
export interface LinkPayload {
  url: string;
  organisationId: string;
  messageId: string;
  campaignId: string;
  lapId: string;
}

export const INTERNAL_SECRET_HEADER = "x-internal-secret";

/** Constant-time comparison over digests so neither length nor content leaks by timing. */
function secretMatches(expected: string, given: string | undefined): boolean {
  if (expected === "" || given === undefined) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

/**
 * Routes the links service calls: `GET /internal/links/:code` on a KV miss and
 * `POST /internal/clicks` when no Cloudflare Queue is bound (or from its consumer).
 * Mount on the worker app with `app.route("/", createInternalLinksRoutes(deps))`.
 */
export function createInternalLinksRoutes(deps: InternalLinksDeps) {
  const log = deps.log ?? defaultLog;
  const app = new Hono();

  app.use("/internal/*", async (c, next) => {
    if (!secretMatches(deps.secret, c.req.header(INTERNAL_SECRET_HEADER))) {
      return c.json({ error: "unauthorised" }, 401);
    }
    await next();
  });

  app.get("/internal/links/:code", async (c) => {
    const code = c.req.param("code");
    if (!isValidShortCode(code)) return c.json({ error: "not found" }, 404);
    const target = await findShortCodeTarget(deps.db, code);
    if (target === null) return c.json({ error: "not found" }, 404);
    if (target.urlTemplate === null) {
      log("warn", "short code has no active link", { campaignId: target.campaignId });
      return c.json({ error: "not found" }, 404);
    }
    const payload: LinkPayload = {
      url: renderLinkUrl(target.urlTemplate, {
        dynamic: target.dynamicId ?? "",
        geo: target.campaignCountry,
        campaign_id: target.campaignId,
        list_id: target.listId,
        route_name: target.routeName,
        phone: target.e164,
      }),
      organisationId: target.organisationId,
      messageId: target.messageId,
      campaignId: target.campaignId,
      lapId: target.lapId,
    };
    c.header("cache-control", "no-store");
    return c.json(payload);
  });

  app.post("/internal/clicks", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const parsed = clickBatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: z.prettifyError(parsed.error) }, 400);
    }
    try {
      await deps.enqueueClicks(parsed.data);
    } catch (err) {
      log("error", "click batch enqueue failed", { clicks: parsed.data.clicks.length, err });
      return c.json({ error: "queue unavailable" }, 503);
    }
    return c.json({ accepted: parsed.data.clicks.length }, 202);
  });

  return app;
}
