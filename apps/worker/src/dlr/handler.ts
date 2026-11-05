import { applyDeliveryReceipt, type Db } from "@sendex/db";
import type { ProviderRegistry } from "@sendex/providers";
import { UnrecoverableError } from "bullmq";
import type { DlrJob } from "../jobs.js";
import { log as defaultLog, type Logger } from "../log.js";
import { DEFAULT_JOB_OPTIONS, type JobMeta } from "../queues.js";

export interface DlrHandlerDeps {
  db: Db;
  providers: ProviderRegistry;
  log?: Logger;
  /**
   * How many attempts a receipt that matches no message gets before it is dropped.
   * Default: the queue's `attempts` (3). A receipt can arrive before the send loop has
   * stored the carrier id (the SMSC answers within milliseconds, the batch outcome is
   * written after the whole batch), so the first miss is retried with backoff.
   */
  maxAttempts?: number;
}

/**
 * The `dlr` job handler (D3-01): parse the raw receipt with the provider named by the job,
 * apply it to the message that carries the carrier id and count it on the lap. Logs ids and
 * statuses only: receipts can carry the destination number and never reach the log.
 */
export function createDlrHandler(deps: DlrHandlerDeps) {
  const log = deps.log ?? defaultLog;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_JOB_OPTIONS.attempts;

  return async (job: DlrJob, meta: JobMeta): Promise<void> => {
    if (!deps.providers.has(job.provider)) {
      throw new UnrecoverableError(`unknown provider "${job.provider}"`);
    }
    const receipt = deps.providers.get(job.provider).parseDeliveryReceipt(job.raw);
    if (receipt === null) {
      throw new UnrecoverableError(`provider "${job.provider}" could not parse the receipt`);
    }
    const fields = {
      jobId: meta.id,
      provider: job.provider,
      providerMessageId: receipt.providerMessageId,
      status: receipt.status,
    };
    const result = await applyDeliveryReceipt(deps.db, { provider: job.provider, receipt });
    if (result.outcome === "applied") {
      log("info", "receipt applied", {
        ...fields,
        messageId: result.messageId,
        lapId: result.lapId,
        campaignId: result.campaignId,
      });
      return;
    }
    if (result.outcome === "ignored") {
      log("info", "receipt ignored, message already final", {
        ...fields,
        messageId: result.messageId,
        lapId: result.lapId,
        current: result.status,
      });
      return;
    }
    const lastAttempt = meta.attemptsMade + 1 >= maxAttempts;
    if (lastAttempt) {
      log("warn", "receipt matched no message, dropped", {
        ...fields,
        attemptsMade: meta.attemptsMade,
      });
      return;
    }
    throw new Error(
      `receipt ${receipt.providerMessageId} from "${job.provider}" matched no message yet`,
    );
  };
}
