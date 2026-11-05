import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createApp } from "./app.js";

const port = Number(process.env.WORKER_PORT ?? 4000);
const version = process.env.SENDEX_VERSION ?? "dev";

const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;

async function checkRedis(): Promise<boolean> {
  if (!redis) return false;
  if (redis.status === "wait") await redis.connect();
  return (await redis.ping()) === "PONG";
}

async function checkDatabase(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const { db } = await import("@sendex/db");
  const rows = await db().execute(sql`select 1 as ok`);
  return rows.length === 1;
}

const app = createApp({ version, checkRedis, checkDatabase });

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ msg: "worker listening", port: info.port, version }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ msg: "worker shutting down", signal }));
  server.close(() => {
    redis?.disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
