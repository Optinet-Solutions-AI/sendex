import type { RedisLike } from "./redis-like.js";
import { LEADER_RELEASE_SCRIPT, LEADER_RENEW_SCRIPT } from "./scripts.js";

export interface LeaderLockOptions {
  /** Redis key, e.g. `sendex:leader:smpp:23telecom`. */
  key: string;
  /** Unique id of this process/instance, stored as the key's value. */
  holderId: string;
  /** How long the key lives without a renewal. Default 15 000 ms. */
  ttlMs?: number;
  /** Renewal period; keep it well under `ttlMs`. Default 5 000 ms. */
  renewEveryMs?: number;
}

export type ResolvedLeaderLockOptions = Required<LeaderLockOptions>;

export type LeaderLostEvent =
  | { key: string; holderId: string; cause: "expired" }
  | { key: string; holderId: string; cause: "error"; error: unknown };

export type LeaderLostListener = (event: LeaderLostEvent) => void;

export interface LeaderLock {
  readonly options: ResolvedLeaderLockOptions;
  /**
   * `SET key holderId NX PX ttl`. Resolves `true` when this holder owns the key (already or
   * just now) and starts the renewal timer; `false` when someone else holds it.
   */
  acquire(): Promise<boolean>;
  /** `true` between a successful `acquire()` and `release()` or a lost renewal. */
  isLeader(): boolean;
  /** Compare-and-delete the key, stop renewing. Safe to call when not the leader. */
  release(): Promise<void>;
  /** Called once per loss (expired, stolen, or a Redis error during renewal). Returns an unsubscribe. */
  onLost(listener: LeaderLostListener): () => void;
}

export const DEFAULT_LEADER_TTL_MS = 15_000;
export const DEFAULT_LEADER_RENEW_EVERY_MS = 5_000;

export function createLeaderLock(redis: RedisLike, options: LeaderLockOptions): LeaderLock {
  const resolved: ResolvedLeaderLockOptions = {
    key: options.key,
    holderId: options.holderId,
    ttlMs: options.ttlMs ?? DEFAULT_LEADER_TTL_MS,
    renewEveryMs: options.renewEveryMs ?? DEFAULT_LEADER_RENEW_EVERY_MS,
  };
  const { key, holderId, ttlMs, renewEveryMs } = resolved;
  const listeners = new Set<LeaderLostListener>();
  let leader = false;
  let timer: NodeJS.Timeout | null = null;
  let renewing: Promise<void> | null = null;

  function stopTimer(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function lose(event: LeaderLostEvent): void {
    if (!leader) return;
    leader = false;
    stopTimer();
    for (const listener of listeners) listener(event);
  }

  async function renewOnce(): Promise<void> {
    if (!leader) return;
    let extended: unknown;
    try {
      extended = await redis.eval(LEADER_RENEW_SCRIPT, 1, key, holderId, ttlMs);
    } catch (error) {
      lose({ key, holderId, cause: "error", error });
      return;
    }
    if (Number(extended) !== 1) lose({ key, holderId, cause: "expired" });
  }

  function renew(): void {
    // Skip a tick while a previous renewal is still in flight (slow Redis).
    if (renewing) return;
    renewing = renewOnce().finally(() => {
      renewing = null;
    });
  }

  function startTimer(): void {
    stopTimer();
    timer = setInterval(renew, renewEveryMs);
    timer.unref();
  }

  return {
    options: resolved,
    async acquire() {
      if (leader) return true;
      const result = await redis.set(key, holderId, "PX", ttlMs, "NX");
      if (result !== "OK") return false;
      leader = true;
      startTimer();
      return true;
    },
    isLeader() {
      return leader;
    },
    async release() {
      stopTimer();
      const wasLeader = leader;
      leader = false;
      if (renewing) await renewing;
      if (wasLeader) await redis.eval(LEADER_RELEASE_SCRIPT, 1, key, holderId);
    },
    onLost(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
