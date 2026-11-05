import {
  deriveEventKey,
  parseIncomingPostback,
  SIGNATURE_PARAM,
  verifyPostbackSignature,
} from "@sendex/core";
import {
  type Db,
  findOrganisationByKey,
  findPostbackByEventKey,
  getOrCreatePostbackKey,
} from "@sendex/db";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { log as defaultLog, type Logger } from "../log.js";
import { type PostbackIngestPayload, toJobEventType } from "./ingest.js";

export interface PostbackRoutesDeps {
  db: Db;
  /** Hand a verified event to the postback-ingest queue. */
  enqueue: (job: PostbackIngestPayload) => Promise<unknown>;
  /**
   * Optional limiter keyed by organisation id; resolve false to refuse with 429. The
   * production wiring passes an Upstash Ratelimit check here (ADR 0004).
   */
  rateLimit?: (organisationId: string) => Promise<boolean>;
  log?: Logger;
}

/** Query parameters merged with the body parameters (body wins) as a flat string map. */
async function readParams(c: Context): Promise<Record<string, unknown> | null> {
  const params: Record<string, unknown> = { ...c.req.query() };
  if (c.req.method !== "POST") return params;
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return null;
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    Object.assign(params, body);
    return params;
  }
  if (contentType.includes("form")) {
    const body = await c.req.parseBody();
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") params[key] = value;
    }
  }
  return params;
}

function stringMap(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * The public conversion endpoint a brand's tracker calls: `GET|POST /postback/:orgKey`
 * where `orgKey` is the organisation id or slug. Parameters come from the query and, for
 * POST, a JSON or form body. The request must carry `sig`, an HMAC-SHA256 of the other
 * parameters under the organisation's postback secret (see docs/using/track-conversions.md).
 * Valid events are queued for ingest and answered 202; a known event key answers 200
 * `{ duplicate: true }` at once. Mount with `app.route("/", createPostbackRoutes(deps))`.
 */
export function createPostbackRoutes(deps: PostbackRoutesDeps) {
  const log = deps.log ?? defaultLog;
  const app = new Hono();
  const rejectedByOrg = new Map<string, number>();

  app.on(["GET", "POST"], "/postback/:orgKey", async (c) => {
    const orgKey = c.req.param("orgKey");
    const organisation = await findOrganisationByKey(deps.db, orgKey);
    if (organisation === null) return c.json({ error: "unknown organisation" }, 404);
    const organisationId = organisation.id;

    if (deps.rateLimit && !(await deps.rateLimit(organisationId))) {
      return c.json({ error: "too many requests" }, 429);
    }

    const raw = await readParams(c);
    if (raw === null) return c.json({ error: "body must be a JSON object" }, 400);
    const params = stringMap(raw);
    const sig = params[SIGNATURE_PARAM];
    const key = await getOrCreatePostbackKey(deps.db, organisationId);
    if (!(await verifyPostbackSignature(params, sig, key.secret))) {
      const rejected = (rejectedByOrg.get(organisationId) ?? 0) + 1;
      rejectedByOrg.set(organisationId, rejected);
      log("warn", "postback signature rejected", {
        organisationId,
        rejected,
        hasSignature: sig !== undefined,
      });
      return c.json({ error: "invalid signature" }, 401);
    }

    const parsed = parseIncomingPostback(raw);
    if (!parsed.success) {
      return c.json({ error: z.prettifyError(parsed.error) }, 400);
    }
    const event = parsed.data;
    const eventKey = await deriveEventKey({
      organisationId,
      type: event.type,
      dynamicId: event.dynamicId,
      clientEventKey: event.clientEventKey,
    });

    if ((await findPostbackByEventKey(deps.db, organisationId, eventKey)) !== null) {
      return c.json({ duplicate: true, eventKey }, 200);
    }

    const job: PostbackIngestPayload = {
      organisationId,
      eventKey,
      type: toJobEventType(event.type),
      dynamicId: event.dynamicId,
      params: event.params,
      ...(event.valueMicro === undefined ? {} : { valueMicro: event.valueMicro }),
    };
    try {
      await deps.enqueue(job);
    } catch (err) {
      log("error", "postback enqueue failed", { organisationId, eventKey, err });
      return c.json({ error: "queue unavailable" }, 503);
    }
    log("info", "postback accepted", { organisationId, eventKey, type: event.type });
    return c.json({ accepted: true, eventKey }, 202);
  });

  return app;
}
