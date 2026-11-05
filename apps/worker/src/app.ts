import { Hono } from "hono";
import type { QueueDepths } from "./health.js";
import { createInternalApi, type InternalApiDeps } from "./internal-api.js";
import { createInternalLinksRoutes, type InternalLinksDeps } from "./links/internal-routes.js";
import { createPostbackRoutes, type PostbackRoutesDeps } from "./postbacks/routes.js";
import { createPublicApi, type PublicApiDeps } from "./public-api/routes.js";

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
  /** Optional: mounts `/internal/links/:code` and `/internal/clicks` for the links service. */
  links?: InternalLinksDeps;
  /** Optional: mounts the public `/postback/:orgKey` endpoint (signed conversion events). */
  postbacks?: PostbackRoutesDeps;
  /** Optional: mounts the public `/api/v1/*` routes, `/api/openapi.json` and `/api/docs`. */
  publicApi?: PublicApiDeps;
}

/** The HTTP surface of the worker: health, the internal API, postbacks and the public API. */
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
  if (deps.links) app.route("/", createInternalLinksRoutes(deps.links));
  if (deps.postbacks) app.route("/", createPostbackRoutes(deps.postbacks));
  if (deps.publicApi) app.route("/", createPublicApi(deps.publicApi));

  return app;
}
