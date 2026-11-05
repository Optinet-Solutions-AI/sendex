import { Hono } from "hono";
import type { QueueDepths } from "./health.js";
import { createInternalApi, type InternalApiDeps } from "./internal-api.js";

export interface HealthDeps {
  version: string;
  checkRedis: () => Promise<boolean>;
  checkDatabase: () => Promise<boolean>;
  /** Optional: when provided, `/health` also reports per-queue depths under `queues`. */
  getQueueDepths?: () => Promise<QueueDepths>;
}

export interface AppDeps extends HealthDeps {
  /** Optional: mounts `/internal/*` (progress and lap creation for the web app). */
  internal?: InternalApiDeps;
}

/** The HTTP surface of the worker: health, the internal API; public API and postbacks later. */
export function createApp(deps: AppDeps) {
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

  if (deps.internal) app.route("/", createInternalApi(deps.internal));

  return app;
}
