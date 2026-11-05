import type { Db, SendingStore } from "@sendex/db";
import type { ProviderRegistry } from "@sendex/providers";
import { createClickIngestHandler } from "./links/ingest.js";
import { log as defaultLog, type Logger } from "./log.js";
import type { JobHandlers } from "./queues.js";
import { dispatchQueuedLaps, type SendQueueLike } from "./send/dispatcher.js";
import type { ProgressTracker, SendRedis } from "./send/progress.js";
import { sendLap } from "./send/send-lap.js";

export interface HandlerDeps {
  log?: Logger;
  /** Database for the ingest handlers (clicks now, postbacks and receipts later). */
  db?: Db;
  store: SendingStore;
  providers: ProviderRegistry;
  redis: Pick<SendRedis, "get">;
  progress: ProgressTracker;
  sendQueue: SendQueueLike;
  send: {
    linksBaseUrl: string;
    batchSize?: number;
    pauseRetryMs?: number;
  };
}

/**
 * The real job handlers. `send` runs the send loop (D2-04/05), `scheduledSend` is the lap
 * dispatcher tick; the ingest handlers are still stubs (D2-07 dlr, D2-12 clicks, D2-14
 * postbacks). Payloads may carry phone numbers (DLR receipts, clicks); only log ids and counts.
 */
export function createHandlers(deps: HandlerDeps): JobHandlers {
  const log = deps.log ?? defaultLog;
  const stubs = createStubHandlers(log);
  return {
    ...stubs,
    ...(deps.db ? { clickIngest: createClickIngestHandler(deps.db, log) } : {}),
    async send(job, meta) {
      const result = await sendLap(
        {
          store: deps.store,
          providers: deps.providers,
          redis: deps.redis,
          progress: deps.progress,
          log,
          ...deps.send,
        },
        job,
        meta,
      );
      log("info", "send lap finished", { jobId: meta.id, lapId: job.lapId, ...result });
    },
    async scheduledSend(_job, meta) {
      const result = await dispatchQueuedLaps({
        store: deps.store,
        sendQueue: deps.sendQueue,
        log,
      });
      if (result.claimed > 0) log("info", "laps dispatched", { jobId: meta.id, ...result });
    },
  };
}

/** Handlers that only log: used until the ingest cards land, and when the worker has no database. */
export function createStubHandlers(log: Logger = defaultLog): JobHandlers {
  return {
    async send(job, meta) {
      log("warn", "send lap (stub: no database)", { jobId: meta.id, lapId: job.lapId });
    },
    async dlr(job, meta) {
      log("info", "delivery receipt (stub)", { jobId: meta.id, provider: job.provider });
    },
    async clickIngest(job, meta) {
      log("info", "click ingest (stub)", { jobId: meta.id, clicks: job.clicks.length });
    },
    async postbackIngest(job, meta) {
      log("info", "postback ingest (stub)", {
        jobId: meta.id,
        eventKey: job.eventKey,
        type: job.type,
      });
    },
    async scheduledSend(job, meta) {
      log("warn", "lap dispatch (stub: no database)", { jobId: meta.id, kind: job.kind });
    },
  };
}
