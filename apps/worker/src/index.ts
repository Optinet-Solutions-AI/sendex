import { serve } from "@hono/node-server";
import { createCapsStore, createSendingStore, db, type SendingStore } from "@sendex/db";
import { createRateLimiter, RATE_LIMITS } from "@sendex/redis-utils";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createAlertChecksStore, createRedisThrottle } from "./alerts/checks.js";
import { createApp } from "./app.js";
import { createHandlers, createStubHandlers } from "./handlers.js";
import { queueDepths } from "./health.js";
import type { ClickBatch } from "./links/ingest.js";
import { log } from "./log.js";
import type { PostbackIngestPayload } from "./postbacks/ingest.js";
import {
  closeQueues,
  createQueues,
  createWorkers,
  QUEUES,
  type Queues,
  type WorkerSet,
  workerSettingsFromEnv,
} from "./queues.js";
import { scheduleLapDispatcher } from "./send/dispatcher.js";
import { createProgressTracker } from "./send/progress.js";
import { createDefaultProviderRegistry } from "./send/providers.js";

const port = Number(process.env.WORKER_PORT ?? 4000);
const version = process.env.SENDEX_VERSION ?? "dev";
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000);
const linksBaseUrl = process.env.LINKS_BASE_URL ?? "http://localhost:8787";
const internalSecret = process.env.INTERNAL_API_SECRET;

// BullMQ requires maxRetriesPerRequest: null on the connection it shares.
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: null }) : null;
redis?.on("error", (err) => log("error", "redis error", { err }));

const store: SendingStore | null = process.env.DATABASE_URL ? createSendingStore(db()) : null;
const progress = redis ? createProgressTracker(redis) : null;

let queues: Queues | null = null;
let workerSet: WorkerSet | null = null;

if (redis) {
  const settings = workerSettingsFromEnv();
  queues = createQueues(redis);
  const handlers =
    store && progress
      ? createHandlers({
          db: db(),
          store,
          providers: createDefaultProviderRegistry(),
          redis,
          progress,
          sendQueue: queues.send,
          send: { linksBaseUrl, pauseRetryMs: settings.pauseRetryMs },
          caps: createCapsStore(db()),
          alerts: { store: createAlertChecksStore(db()), throttle: createRedisThrottle(redis) },
        })
      : createStubHandlers();
  workerSet = createWorkers(redis, handlers, { settings });
  log("info", "workers started", { queues: Object.values(QUEUES), ...settings });
  if (store) {
    scheduleLapDispatcher(queues.scheduledSend, settings.lapPollMs)
      .then(() => log("info", "lap dispatcher scheduled", { everyMs: settings.lapPollMs }))
      .catch((err: unknown) => log("error", "lap dispatcher could not be scheduled", { err }));
  } else {
    log("warn", "DATABASE_URL not set: send and dispatch handlers are stubs");
  }
} else {
  log("warn", "REDIS_URL not set: queues and workers are disabled");
}

async function checkRedis(): Promise<boolean> {
  if (!redis) return false;
  return (await redis.ping()) === "PONG";
}

async function checkDatabase(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const rows = await db().execute(sql`select 1 as ok`);
  return rows.length === 1;
}

const allQueues =
  queues && workerSet
    ? [...Object.values(queues), ...Object.values(workerSet.deadLetterQueues)]
    : null;

const linksDeps =
  store && queues && internalSecret
    ? {
        db: db(),
        secret: internalSecret,
        enqueueClicks: (batch: ClickBatch) => (queues as Queues).clickIngest.add("clicks", batch),
      }
    : null;

// Public postback endpoint: one sliding window per organisation (RATE_LIMITS.postback) when
// Redis is up; without Redis the endpoint still works, just unthrottled.
const postbackLimiter = redis ? createRateLimiter(redis, { prefix: "sendex:rl" }) : null;
const postbacksDeps =
  store && queues
    ? {
        db: db(),
        enqueue: (job: PostbackIngestPayload) =>
          (queues as Queues).postbackIngest.add("postback", job),
        ...(postbackLimiter
          ? {
              rateLimit: async (organisationId: string) =>
                (
                  await postbackLimiter.limit({
                    key: `postback:${organisationId}`,
                    max: RATE_LIMITS.postback.max,
                    windowMs: RATE_LIMITS.postback.windowMs,
                  })
                ).allowed,
            }
          : {}),
      }
    : null;

const app = createApp({
  version,
  checkRedis,
  checkDatabase,
  ...(allQueues ? { getQueueDepths: () => queueDepths(allQueues) } : {}),
  ...(store && progress ? { internal: { secret: internalSecret, store, progress } } : {}),
  ...(linksDeps ? { links: linksDeps } : {}),
  ...(postbacksDeps ? { postbacks: postbacksDeps } : {}),
});
if (!internalSecret) log("warn", "INTERNAL_API_SECRET not set: /internal routes answer 503");

const server = serve({ fetch: app.fetch, port }, (info) => {
  log("info", "worker listening", { port: info.port, version });
});

let shuttingDown = false;

/** Stop HTTP, let in-flight jobs finish, close producers, then drop the Redis connection. */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "worker shutting down", { signal });

  const forceExit = setTimeout(() => {
    log("error", "shutdown timed out, exiting", { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      if ("closeIdleConnections" in server) server.closeIdleConnections();
    });
    await workerSet?.close();
    if (queues) await closeQueues(queues);
    await redis?.quit();
    log("info", "worker stopped");
    process.exit(0);
  } catch (err) {
    log("error", "shutdown failed", { err });
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
