import type { CapsStore, Db, SendingStore } from "@sendex/db";
import type { ProviderRegistry } from "@sendex/providers";
import { type AlertChecksStore, type CheckThrottle, runAlertChecks } from "./alerts/checks.js";
import { createClickIngestHandler } from "./links/ingest.js";
import { log as defaultLog, type Logger } from "./log.js";
import { createPostbackIngestHandler } from "./postbacks/ingest.js";
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
  /** Daily caps for the send loop (D3-11); without it no cap is enforced. */
  caps?: CapsStore;
  /** Spike and low balance checks run from the dispatcher tick (D3-11). */
  alerts?: { store: AlertChecksStore; throttle: CheckThrottle };
}

/**
 * The real job handlers. `send` runs the send loop (D2-04/05), `scheduledSend` is the lap
 * dispatcher tick; clicks and postbacks are ingested when a db is given (D2-12, D3-03), the
 * DLR handler is still a stub (D2-07). Payloads may carry phone numbers (DLR receipts, clicks); only log ids and counts.
 */
export function createHandlers(deps: HandlerDeps): JobHandlers {
  const log = deps.log ?? defaultLog;
  const stubs = createStubHandlers(log);
  return {
    ...stubs,
    ...(deps.db
      ? {
          clickIngest: createClickIngestHandler(deps.db, log),
          postbackIngest: createPostbackIngestHandler(deps.db, log),
        }
      : {}),
    async send(job, meta) {
      const result = await sendLap(
        {
          store: deps.store,
          providers: deps.providers,
          redis: deps.redis,
          progress: deps.progress,
          log,
          ...deps.send,
          ...(deps.caps ? { caps: deps.caps } : {}),
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
      if (deps.alerts) {
        // Spike and low balance checks ride on the tick; a failure here must not fail the dispatch.
        try {
          const checks = await runAlertChecks({ ...deps.alerts, log });
          if (checks.spikesRaised + checks.lowBalanceRaised + checks.rearmed > 0) {
            log("info", "alert checks", { jobId: meta.id, ...checks });
          }
        } catch (err) {
          log("error", "alert checks failed", { jobId: meta.id, err });
        }
      }
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
