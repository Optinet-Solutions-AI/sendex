import { createHmac, timingSafeEqual } from "node:crypto";
import { isFinalDeliveryStatus } from "@sendex/providers";
import { Hono } from "hono";
import type { DlrJob } from "../jobs.js";
import { log as defaultLog, type Logger } from "../log.js";
import { TELECOM23_PROVIDER_NAME } from "../send/providers.js";

export const TELECOM23_DELIVERY_PATH = "/webhooks/23telecom/delivery";

/** How far the `X-Webhook-Timestamp` may drift from our clock, in seconds. */
const MAX_SKEW_SECONDS = 300;

export interface Telecom23WebhookDeps {
  /** Put the receipt on the `dlr` queue under the 23telecom provider name. */
  enqueue: (job: DlrJob) => Promise<unknown>;
  /**
   * The signing secret set in the 23Telecom portal (Webhooks, Security). When present every
   * request must carry `X-Webhook-Timestamp` and `X-Webhook-Signature: sha256=<hex>` where the
   * hex is HMAC-SHA256(secret, `${timestamp}.${rawBody}`). Without it, requests are accepted
   * unsigned (sandbox only; set the secret before going live).
   */
  signingSecret?: string;
  log?: Logger;
}

function verifySignature(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  body: string,
): boolean {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const ts = Number(timestamp);
  if (
    !Number.isSafeInteger(ts) ||
    Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_SKEW_SECONDS
  ) {
    return false;
  }
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`,
  );
  const provided = Buffer.from(signature);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/**
 * 23Telecom's delivery report webhook (`POST /webhooks/23telecom/delivery`). The carrier
 * expects a 2xx within five seconds and retries on 408, 429, 5xx and timeouts, so the route
 * only verifies, filters and enqueues; `createDlrHandler` applies the receipt from the queue.
 * Intermediate states (`SENT`, `ENROUTE`, `ACCEPTD`) are acknowledged and dropped: the
 * message is already `sent` on our side. Mount with `app.route("/", createTelecom23WebhookRoutes(deps))`.
 */
export function createTelecom23WebhookRoutes(deps: Telecom23WebhookDeps) {
  const log = deps.log ?? defaultLog;
  const app = new Hono();

  app.post(TELECOM23_DELIVERY_PATH, async (c) => {
    const body = await c.req.text();
    if (deps.signingSecret) {
      const ok = verifySignature(
        deps.signingSecret,
        c.req.header("x-webhook-timestamp"),
        c.req.header("x-webhook-signature"),
        body,
      );
      if (!ok) {
        log("warn", "23telecom webhook signature rejected");
        return c.json({ ok: false, error: "invalid signature" }, 401);
      }
    }

    let event: unknown;
    try {
      event = JSON.parse(body);
    } catch {
      return c.json({ ok: false, error: "body must be JSON" }, 400);
    }
    if (event === null || typeof event !== "object" || Array.isArray(event)) {
      return c.json({ ok: false, error: "body must be a delivery event" }, 400);
    }
    const { message_id: messageId, status } = event as { message_id?: unknown; status?: unknown };
    if (typeof messageId !== "string" || messageId === "" || typeof status !== "string") {
      return c.json({ ok: false, error: "message_id and status are required" }, 400);
    }
    if (!isFinalDeliveryStatus(status)) {
      return c.json({ ok: true, ignored: status });
    }

    try {
      await deps.enqueue({ provider: TELECOM23_PROVIDER_NAME, raw: event });
    } catch (err) {
      log("error", "23telecom receipt could not be queued", {
        providerMessageId: messageId,
        status,
        err,
      });
      return c.json({ ok: false, error: "try again" }, 503);
    }
    return c.json({ ok: true });
  });

  return app;
}
