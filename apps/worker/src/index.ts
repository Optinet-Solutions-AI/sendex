import os from "node:os";
import { serve } from "@hono/node-server";
import {
  createAutosenderStore,
  createCapsStore,
  createSendingStore,
  db,
  type SendingStore,
} from "@sendex/db";
import { createRateLimiter, RATE_LIMITS } from "@sendex/redis-utils";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { createAlertChecksStore, createRedisThrottle } from "./alerts/checks.js";
import { createApp } from "./app.js";
import { subscribeDeliveryReceipts } from "./dlr/subscribe.js";
import { createHandlers, createStubHandlers } from "./handlers.js";
import { cachedQueueDepths, DEFAULT_QUEUE_DEPTH_CACHE_MS, queueDepths } from "./health.js";
import type { DlrJob } from "./jobs.js";
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
import { bindSmppAsLeader, type SmppLeadership } from "./send/smpp-leader.js";

const port = Number(process.env.WORKER_PORT ?? 4000);
const version = process.env.SENDEX_VERSION ?? "dev";
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000);
const linksBaseUrl = process.env.LINKS_BASE_URL ?? "http://localhost:8787";
const internalSecret = process.env.INTERNAL_API_SECRET;
// Receipt expiry (D3-01): a `sent` message with no receipt after this long is expired.
const dlrExpiryMs = Number(process.env.DLR_EXPIRY_MS ?? 24 * 60 * 60 * 1000);
const dlrExpiryPollMs = Number(process.env.DLR_EXPIRY_POLL_MS ?? 60_000);
// Receipt poll (D2-23): a `sent` message with no receipt after the grace period is looked up
// at carriers that can be polled (23Telecom REST), every RECEIPT_POLL_EVERY_MS.
const receiptPollAfterMs = Number(process.env.RECEIPT_POLL_AFTER_MS ?? 10 * 60 * 1000);
const receiptPollEveryMs = Number(process.env.RECEIPT_POLL_EVERY_MS ?? 60_000);

// BullMQ requires maxRetriesPerRequest: null on the connection it shares.
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: null }) : null;
redis?.on("error", (err) => log("error", "redis error", { err }));

const store: SendingStore | null = process.env.DATABASE_URL ? createSendingStore(db()) : null;
const progress = redis ? createProgressTracker(redis) : null;

let queues: Queues | null = null;
let workerSet: WorkerSet | null = null;
let smppLeadership: SmppLeadership | null = null;

if (redis) {
  const settings = workerSettingsFromEnv();
  queues = createQueues(redis);
  const providers = createDefaultProviderRegistry();
  const handlers =
    store && progress
      ? createHandlers({
          db: db(),
          store,
          providers,
          redis,
          progress,
          sendQueue: queues.send,
          send: { linksBaseUrl, pauseRetryMs: settings.pauseRetryMs },
          caps: createCapsStore(db()),
          autosender: createAutosenderStore(db()),
          alerts: { store: createAlertChecksStore(db()), throttle: createRedisThrottle(redis) },
          expiry: { windowMs: dlrExpiryMs, everyMs: dlrExpiryPollMs },
          receiptPoll: { afterMs: receiptPollAfterMs, everyMs: receiptPollEveryMs },
        })
      : createStubHandlers();
  workerSet = createWorkers(redis, handlers, { settings });
  log("info", "workers started", { queues: Object.values(QUEUES), ...settings });
  // Delivery receipts arrive on the bound SMPP session, not per job: enqueue them on `dlr`.
  const dlrQueue = queues.dlr;
  const receipts = subscribeDeliveryReceipts({
    registry: providers,
    enqueue: (job) => dlrQueue.add("receipt", job),
    log,
  });
  if (receipts.providers.length > 0) {
    log("info", "delivery receipts subscribed", { providers: receipts.providers });
    // One bind per provider across all machines (D2-16): the lock holder binds and sends, the
    // others keep their send worker paused and retry. A lost lock shuts the process down so
    // the platform restarts it with a fresh session.
    smppLeadership = bindSmppAsLeader({
      registry: providers,
      redis,
      holderId: process.env.FLY_MACHINE_ID ?? `${os.hostname()}:${process.pid}`,
      log,
      sendWorker: workerSet.workers.send,
      onLost: () => void shutdown("smpp leadership lost"),
    });
  }
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
// Health probes every 15 s would otherwise cost 40 Redis commands each (D3-23).
const queueDepthCacheMs = Number(process.env.QUEUE_DEPTH_CACHE_MS ?? DEFAULT_QUEUE_DEPTH_CACHE_MS);
const getQueueDepths = allQueues
  ? cachedQueueDepths(() => queueDepths(allQueues), queueDepthCacheMs)
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
// The Unsubscribe API shares the postback limiter (same shape: per organisation, per minute).
const unsubscribeDeps = {
  db: db(),
  ...(postbackLimiter
    ? {
        rateLimit: async (organisationId: string) =>
          (
            await postbackLimiter.limit({
              key: `unsubscribe:${organisationId}`,
              max: RATE_LIMITS.postback.max,
              windowMs: RATE_LIMITS.postback.windowMs,
            })
          ).allowed,
      }
    : {}),
};
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

// Public API (D3-17): bearer tokens, one sliding window per token (RATE_LIMITS.publicApi)
// when Redis is up. Served under WORKER_PUBLIC_URL, which the OpenAPI document names.
const publicApiDeps =
  store && progress
    ? {
        db: db(),
        store,
        progress,
        version,
        serverUrl: process.env.WORKER_PUBLIC_URL ?? `http://localhost:${port}`,
        ...(postbackLimiter ? { rateLimit: { limiter: postbackLimiter } } : {}),
      }
    : null;

// 23Telecom delivery reports (D2-22): the carrier posts to this public route; receipts go on
// the `dlr` queue like SMPP ones. Mounted only when the provider is configured.
const telecom23Secret = process.env.TELECOM23_WEBHOOK_SECRET?.trim();
const telecom23WebhookDeps =
  queues && process.env.TELECOM23_API_KEY
    ? {
        enqueue: (job: DlrJob) => (queues as Queues).dlr.add("receipt", job),
        ...(telecom23Secret ? { signingSecret: telecom23Secret } : {}),
      }
    : null;

const app = createApp({
  version,
  checkRedis,
  checkDatabase,
  ...(getQueueDepths ? { getQueueDepths } : {}),
  ...(store && progress && redis
    ? { internal: { secret: internalSecret, store, progress, redis } }
    : {}),
  ...(linksDeps ? { links: linksDeps } : {}),
  ...(postbacksDeps ? { postbacks: postbacksDeps } : {}),
  ...(store ? { unsubscribe: unsubscribeDeps } : {}),
  ...(publicApiDeps ? { publicApi: publicApiDeps } : {}),
  ...(telecom23WebhookDeps ? { telecom23Webhook: telecom23WebhookDeps } : {}),
});
if (telecom23WebhookDeps && !telecom23Secret) {
  log("warn", "TELECOM23_WEBHOOK_SECRET not set: delivery webhook accepts unsigned requests");
}
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
    // Release the SMPP lock before anything else so the next machine takes over quickly.
    await smppLeadership?.close();
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
