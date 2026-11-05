import { type Db, expireStaleMessages, RECEIPT_WINDOW_MS } from "@sendex/db";
import type { Logger } from "../log.js";

export const DEFAULT_EXPIRY_POLL_MS = 60_000;

export interface ExpiryTickDeps {
  db: Db;
  log: Logger;
  /** A `sent` message older than this without a receipt expires. Default 24 h. */
  windowMs?: number | undefined;
  /** Minimum time between two sweeps; the dispatcher tick calls this far more often. Default 60 s. */
  everyMs?: number | undefined;
  /** Messages per sweep. Default 10 000. */
  limit?: number | undefined;
  now?: () => Date;
}

/**
 * The expiry sweep (D3-01), run from the `scheduled-send` tick: marks `sent` messages
 * older than the receipt window as `expired` and counts them as failed on their laps.
 * Throttled to once per `everyMs` per process; returns how many messages expired (0 when
 * the sweep was skipped).
 */
export function createExpiryTick(deps: ExpiryTickDeps): () => Promise<number> {
  const windowMs = deps.windowMs ?? RECEIPT_WINDOW_MS;
  const everyMs = deps.everyMs ?? DEFAULT_EXPIRY_POLL_MS;
  let lastRunAt = Number.NEGATIVE_INFINITY;
  return async () => {
    const now = deps.now?.() ?? new Date();
    if (now.getTime() - lastRunAt < everyMs) return 0;
    lastRunAt = now.getTime();
    const olderThan = new Date(now.getTime() - windowMs);
    const expired = await expireStaleMessages(deps.db, olderThan, {
      ...(deps.limit === undefined ? {} : { limit: deps.limit }),
    });
    if (expired > 0) {
      deps.log("info", "stale messages expired", { expired, olderThan: olderThan.toISOString() });
    }
    return expired;
  };
}
