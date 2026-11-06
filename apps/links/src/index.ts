/**
 * Cloudflare Workers entry. Only handlers may be exported from this module: workerd treats
 * every export as an entrypoint, so the app, types and constants live in `app.ts`.
 */
import { app, type Bindings } from "./app.js";
import { type ClickRecord, forwardClickBatch } from "./clicks.js";

export default {
  fetch: app.fetch,
  /** Cloudflare Queue consumer for `CLICKS`: batches go to the worker's `/internal/clicks`. */
  queue(batch: MessageBatch<ClickRecord>, env: Bindings): Promise<void> {
    return forwardClickBatch(batch, { workerUrl: env.WORKER_URL, secret: env.INTERNAL_API_SECRET });
  },
};
