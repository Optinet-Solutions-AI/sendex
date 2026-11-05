import { Hono } from "hono";
import type { QueueDepths } from "./health.js";

export interface HealthDeps {
  version: string;
  checkRedis: () => Promise<boolean>;
  checkDatabase: () => Promise<boolean>;
  /** Optional: when provided, `/health` also reports per-queue depths under `queues`. */
  getQueueDepths?: () => Promise<QueueDepths>;
}

/** The HTTP surface of the worker: health now, public API and postbacks in later cards. */
export function createApp(deps: HealthDeps) {
  const app = new Hono();

  app.get("/health", async (c) => {
    const [redis, database, queues] = await Promise.all([
      deps.checkRedis().catch(() => false),
      deps.checkDatabase().catch(() => false),
      deps.getQueueDepths ? deps.getQueueDepths().catch(() => null) : undefined,
    ]);
    const ok = redis && database;
    const body = { ok, version: deps.version, redis, database };
    return c.json(queues === undefined ? body : { ...body, queues }, ok ? 200 : 503);
  });

  return app;
}
