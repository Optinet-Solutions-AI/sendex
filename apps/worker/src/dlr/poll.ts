import { applyDeliveryReceipt, type Db, listMessagesAwaitingReceipt } from "@sendex/db";
import { canPollReceipts, type ProviderRegistry } from "@sendex/providers";
import type { Logger } from "../log.js";

/** A `sent` message gets this long for the carrier's own webhook before it is polled. */
export const DEFAULT_RECEIPT_POLL_AFTER_MS = 10 * 60 * 1000;
/** Minimum time between two polls per process. */
export const DEFAULT_RECEIPT_POLL_EVERY_MS = 60_000;
/** Ids asked per provider per poll. */
export const DEFAULT_RECEIPT_POLL_LIMIT = 200;
/** After a carrier failure, leave that carrier alone for this long. */
export const DEFAULT_RECEIPT_POLL_BACKOFF_MS = 5 * 60 * 1000;

export interface ReceiptPollTickDeps {
  db: Db;
  providers: ProviderRegistry;
  log: Logger;
  afterMs?: number | undefined;
  everyMs?: number | undefined;
  limit?: number | undefined;
  backoffMs?: number | undefined;
  now?: () => Date;
}

export interface ReceiptPollResult {
  /** Ids asked about, across providers. */
  polled: number;
  /** Receipts that changed a message. */
  applied: number;
  /** Receipts for messages that were already final. */
  ignored: number;
  /** Receipts whose id matched no message. */
  unknown: number;
}

const EMPTY: ReceiptPollResult = { polled: 0, applied: 0, ignored: 0, unknown: 0 };

/**
 * The receipt poll (D2-23), run from the `scheduled-send` tick after the expiry sweep: for
 * every registered provider that can be polled, list `sent` messages older than `afterMs`
 * that still have no receipt, ask the carrier, and apply the final ones exactly like a
 * webhook receipt. A carrier failure is logged and that carrier is skipped for `backoffMs` (5 min).
 * Throttled to once per `everyMs` per process.
 */
export function createReceiptPollTick(deps: ReceiptPollTickDeps): () => Promise<ReceiptPollResult> {
  const afterMs = deps.afterMs ?? DEFAULT_RECEIPT_POLL_AFTER_MS;
  const everyMs = deps.everyMs ?? DEFAULT_RECEIPT_POLL_EVERY_MS;
  const limit = deps.limit ?? DEFAULT_RECEIPT_POLL_LIMIT;
  const backoffMs = deps.backoffMs ?? DEFAULT_RECEIPT_POLL_BACKOFF_MS;
  let lastRunAt = Number.NEGATIVE_INFINITY;
  /** Provider name -> instant until which it is not asked, after a failure. */
  const pausedUntil = new Map<string, number>();

  return async () => {
    const now = deps.now?.() ?? new Date();
    if (now.getTime() - lastRunAt < everyMs) return EMPTY;
    lastRunAt = now.getTime();
    const sentBefore = new Date(now.getTime() - afterMs);
    const total: ReceiptPollResult = { ...EMPTY };

    for (const name of deps.providers.names()) {
      const provider = deps.providers.get(name);
      if (!canPollReceipts(provider)) continue;
      if ((pausedUntil.get(name) ?? Number.NEGATIVE_INFINITY) > now.getTime()) continue;
      const ids = await listMessagesAwaitingReceipt(deps.db, { provider: name, sentBefore, limit });
      if (ids.length === 0) continue;
      total.polled += ids.length;

      let receipts: Awaited<ReturnType<typeof provider.pollReceipts>>;
      try {
        receipts = await provider.pollReceipts(ids);
      } catch (err) {
        // A refused or failing carrier is not asked again for `backoffMs`: hammering a carrier
        // that is already refusing us is how the worker's IP got blocked once.
        pausedUntil.set(name, now.getTime() + backoffMs);
        deps.log("error", "receipt poll failed", {
          provider: name,
          polled: ids.length,
          retryAfterMs: backoffMs,
          err,
        });
        continue;
      }

      const counts = { applied: 0, ignored: 0, unknown: 0 };
      for (const receipt of receipts) {
        const result = await applyDeliveryReceipt(deps.db, { provider: name, receipt });
        counts[result.outcome] += 1;
      }
      total.applied += counts.applied;
      total.ignored += counts.ignored;
      total.unknown += counts.unknown;
      deps.log("info", "receipts polled", {
        provider: name,
        polled: ids.length,
        final: receipts.length,
        ...counts,
      });
    }
    return total;
  };
}
