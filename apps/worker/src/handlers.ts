import { log as defaultLog, type Logger } from "./log.js";
import type { JobHandlers } from "./queues.js";

/**
 * The real job handlers. Stubs for now: each one logs the job and returns, so the queue
 * plumbing can be exercised end to end. D2-04 onwards replace them one by one.
 * Payloads may carry phone numbers (DLR receipts, clicks); only log ids and counts.
 */
export function createHandlers(log: Logger = defaultLog): JobHandlers {
  return {
    async send(job, meta) {
      log("info", "send lap (stub)", {
        jobId: meta.id,
        organisationId: job.organisationId,
        campaignId: job.campaignId,
        lapId: job.lapId,
      });
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
      log("info", "scheduled send (stub)", {
        jobId: meta.id,
        organisationId: job.organisationId,
        campaignId: job.campaignId,
      });
    },
  };
}
