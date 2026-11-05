import { Hono } from "hono";

export interface HealthDeps {
  version: string;
  checkRedis: () => Promise<boolean>;
  checkDatabase: () => Promise<boolean>;
}

/** The HTTP surface of the worker: health now, public API and postbacks in later cards. */
export function createApp(deps: HealthDeps) {
  const app = new Hono();

  app.get("/health", async (c) => {
    const [redis, database] = await Promise.all([
      deps.checkRedis().catch(() => false),
      deps.checkDatabase().catch(() => false),
    ]);
    const ok = redis && database;
    return c.json({ ok, version: deps.version, redis, database }, ok ? 200 : 503);
  });

  return app;
}
