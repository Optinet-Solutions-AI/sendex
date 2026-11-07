import type { AutosenderStore, CapsStore, Db, SendingStore } from "@sendex/db";
import type { LookupProvider, ProviderRegistry } from "@sendex/providers";
import { type AlertChecksStore, type CheckThrottle, runAlertChecks } from "./alerts/checks.js";
import { createDlrHandler } from "./dlr/handler.js";
import { createReceiptPollTick } from "./dlr/poll.js";
import { createClickIngestHandler } from "./links/ingest.js";
import { log as defaultLog, type Logger } from "./log.js";
import { createPostbackIngestHandler } from "./postbacks/ingest.js";
import type { JobHandlers } from "./queues.js";
import { runAutosenderTick } from "./send/autosender.js";
import { dispatchQueuedLaps, type SendQueueLike } from "./send/dispatcher.js";
import { createExpiryTick } from "./send/expiry.js";
import type { ProgressTracker, SendRedis } from "./send/progress.js";
import { sendLap } from "./send/send-lap.js";
import {
  dispatchDueTests,
  type TestDispatchStore,
  type TestQueueLike,
} from "./tests/dispatcher.js";
import { runSmsTest, type TestStore } from "./tests/run-test.js";
import {
  dispatchVerification,
  runVerification,
  type VerificationDispatchStore,
  type VerificationStore,
  type VerifyQueueLike,
} from "./verification/run-verification.js";

export interface HandlerDeps {
  log?: Logger;
  /** Database for the ingest handlers (clicks, postbacks, receipts) and the expiry sweep. */
  db?: Db;
  /** Receipt expiry (D3-01): window and sweep interval; defaults 24 h and 60 s. */
  expiry?: { windowMs?: number | undefined; everyMs?: number | undefined };
  /** Receipt poll (D2-23): grace period before a `sent` message is asked about, and interval; defaults 10 min and 60 s. */
  receiptPoll?: { afterMs?: number | undefined; everyMs?: number | undefined };
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
  /** AutoSender (D4-02) rides on the tick too; without it no campaign is scaled out. */
  autosender?: AutosenderStore;
  /** Routes > Testing (D4-06): the tests store and queue; without them no test runs. */
  tests?: { store: TestStore & TestDispatchStore; queue: TestQueueLike };
  /** Numbers Verification (D4-07): store, queue and the lookup provider (null = none configured). */
  verification?: {
    store: VerificationStore & VerificationDispatchStore;
    queue: VerifyQueueLike;
    lookup: LookupProvider | null;
  };
}

/**
 * The real job handlers. `send` runs the send loop (D2-04/05), `scheduledSend` is the lap
 * dispatcher tick plus the receipt expiry sweep (D3-01) and the receipt poll (D2-23); clicks, postbacks and delivery
 * receipts are ingested when a db is given (D2-12, D3-03, D3-01). Payloads may carry phone
 * numbers (DLR receipts, clicks); only log ids and counts.
 */
export function createHandlers(deps: HandlerDeps): JobHandlers {
  const log = deps.log ?? defaultLog;
  const stubs = createStubHandlers(log);
  const expiry = deps.db ? createExpiryTick({ db: deps.db, log, ...deps.expiry }) : null;
  const receiptPoll = deps.db
    ? createReceiptPollTick({ db: deps.db, providers: deps.providers, log, ...deps.receiptPoll })
    : null;
  return {
    ...stubs,
    ...(deps.db
      ? {
          dlr: createDlrHandler({ db: deps.db, providers: deps.providers, log }),
          clickIngest: createClickIngestHandler(deps.db, log),
          postbackIngest: createPostbackIngestHandler(deps.db, log),
        }
      : {}),
    async verify(job, meta) {
      if (!deps.verification) {
        log("warn", "verification (stub: no store)", { jobId: meta.id, requestId: job.requestId });
        return;
      }
      const result = await runVerification(
        { store: deps.verification.store, lookup: deps.verification.lookup, log },
        job,
      );
      log("info", "verification job finished", {
        jobId: meta.id,
        requestId: job.requestId,
        ...result,
      });
    },
    async smsTests(job, meta) {
      if (!deps.tests) {
        log("warn", "sms test (stub: no tests store)", { jobId: meta.id, testId: job.testId });
        return;
      }
      const result = await runSmsTest(
        { store: deps.tests.store, providers: deps.providers, log },
        job,
      );
      log("info", "sms test job finished", { jobId: meta.id, testId: job.testId, ...result });
    },
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
      // The expiry sweep rides on the same tick; a failure must not fail the dispatch.
      if (expiry) {
        await expiry().catch((err: unknown) =>
          log("error", "receipt expiry sweep failed", { jobId: meta.id, err }),
        );
      }
      // Then the receipt poll (D2-23), for carriers that can be asked about lost webhooks.
      if (receiptPoll) {
        await receiptPoll().catch((err: unknown) =>
          log("error", "receipt poll sweep failed", { jobId: meta.id, err }),
        );
      }
      // Routes > Testing (D4-06): queued and due scheduled tests go on the sms-tests queue.
      if (deps.tests) {
        const tests = deps.tests;
        await dispatchDueTests({ store: tests.store, queue: tests.queue, log })
          .then((r) => {
            if (r.enqueued > 0) log("info", "sms tests dispatched", { jobId: meta.id, ...r });
          })
          .catch((err: unknown) =>
            log("error", "sms test dispatch failed", { jobId: meta.id, err }),
          );
      }
      // Numbers Verification (D4-07): enrichment rules create requests; queued ones are enqueued.
      if (deps.verification) {
        const verification = deps.verification;
        await dispatchVerification({
          store: verification.store,
          queue: verification.queue,
          log,
        }).catch((err: unknown) =>
          log("error", "verification dispatch failed", { jobId: meta.id, err }),
        );
      }
      // AutoSender (D4-02): measure test rounds and queue scale-out laps for the next tick.
      if (deps.autosender) {
        await runAutosenderTick({ store: deps.autosender, log })
          .then((r) => {
            if (r.scaled + r.stopped + r.failed > 0)
              log("info", "autosender tick", { jobId: meta.id, ...r });
          })
          .catch((err: unknown) => log("error", "autosender tick failed", { jobId: meta.id, err }));
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
    async smsTests(job, meta) {
      log("warn", "sms test (stub: no database)", { jobId: meta.id, testId: job.testId });
    },
    async verify(job, meta) {
      log("warn", "verification (stub: no database)", { jobId: meta.id, requestId: job.requestId });
    },
  };
}
