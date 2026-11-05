import { type ProviderRegistry, SmppProvider } from "@sendex/providers";
import { createLeaderLock, type LeaderLock, type RedisLike } from "@sendex/redis-utils";
import type { Logger } from "../log.js";

/** The slice of a BullMQ `Worker` the leadership needs: stop and start taking send jobs. */
export interface SendWorkerLike {
  pause(doNotWaitActive?: boolean): Promise<void>;
  resume(): void;
}

export interface SmppLeaderDeps {
  registry: ProviderRegistry;
  redis: RedisLike;
  /** Unique per process: the Fly machine id, or host and pid. */
  holderId: string;
  log: Logger;
  /**
   * The `send` queue worker. It is paused while this process leads no SMPP provider, so the
   * jobs wait for the machine that holds the bind instead of opening a second one.
   */
  sendWorker?: SendWorkerLike;
  /**
   * Called after a held bind was lost (expired or stolen key). The session cannot rebind
   * after `close()`, so the worker should shut down and let the platform restart it.
   */
  onLost?: (provider: string) => void;
  /** How often a non-leader retries `acquire()`. Default 5 000 ms. */
  retryMs?: number;
  ttlMs?: number;
  renewEveryMs?: number;
}

export interface SmppLeadership {
  /** Registry names of the SMPP providers under leadership (empty when there are none). */
  readonly providers: readonly string[];
  isLeader(provider: string): boolean;
  /** Release every lock first (the next machine takes over within one retry), then unbind. */
  close(): Promise<void>;
}

const DEFAULT_RETRY_MS = 5_000;

export function smppLeaderKey(provider: string): string {
  return `sendex:leader:smpp:${provider}`;
}

/**
 * Exactly one worker process binds each SMPP provider (D2-16): 23Telecom allows a fixed
 * number of binds per account. Every process races for `sendex:leader:smpp:<provider>`; the
 * winner binds and takes send jobs, the others retry every `retryMs` with their send worker
 * paused. On `SIGTERM` the leader releases the key so the hand-over takes one retry interval,
 * not one TTL. Receipts for messages sent before a hand-over arrive on the new bind and are
 * matched by provider message id, nothing is re-sent.
 */
export function bindSmppAsLeader(deps: SmppLeaderDeps): SmppLeadership {
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;
  const entries: Array<{ name: string; provider: SmppProvider; lock: LeaderLock }> = [];
  for (const name of deps.registry.names()) {
    const provider = deps.registry.get(name);
    if (!(provider instanceof SmppProvider)) continue;
    const lock = createLeaderLock(deps.redis, {
      key: smppLeaderKey(name),
      holderId: deps.holderId,
      ...(deps.ttlMs !== undefined ? { ttlMs: deps.ttlMs } : {}),
      ...(deps.renewEveryMs !== undefined ? { renewEveryMs: deps.renewEveryMs } : {}),
    });
    entries.push({ name, provider, lock });
  }

  const leading = new Set<string>();
  const timers = new Map<string, NodeJS.Timeout>();
  let closed = false;

  function syncSendWorker(): void {
    if (!deps.sendWorker || entries.length === 0) return;
    if (leading.size > 0) deps.sendWorker.resume();
    else void deps.sendWorker.pause(true);
  }

  function scheduleRetry(name: string, attempt: () => void): void {
    if (closed) return;
    const timer = setTimeout(attempt, retryMs);
    timer.unref();
    timers.set(name, timer);
  }

  for (const entry of entries) {
    const { name, provider, lock } = entry;
    const fields = { provider: name, holderId: deps.holderId };

    lock.onLost((event) => {
      leading.delete(name);
      syncSendWorker();
      deps.log("warn", "smpp leadership lost", { ...fields, cause: event.cause });
      provider.close().catch((err: unknown) => {
        deps.log("error", "smpp unbind after lost leadership failed", { ...fields, err });
      });
      deps.onLost?.(name);
    });

    const attempt = (): void => {
      timers.delete(name);
      if (closed) return;
      lock.acquire().then(
        (won) => {
          if (closed) return;
          if (!won) {
            scheduleRetry(name, attempt);
            return;
          }
          leading.add(name);
          syncSendWorker();
          deps.log("info", "smpp leadership acquired", fields);
          provider.connect().then(
            () => deps.log("info", "smpp provider bound", fields),
            (err: unknown) => deps.log("error", "smpp provider bind failed", { ...fields, err }),
          );
        },
        (err: unknown) => {
          deps.log("error", "smpp leader lock acquire failed", { ...fields, err });
          scheduleRetry(name, attempt);
        },
      );
    };
    attempt();
  }
  // Until a lock is won this process must not take send jobs (a send would bind).
  syncSendWorker();

  return {
    providers: entries.map((e) => e.name),
    isLeader: (provider) => leading.has(provider),
    async close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.all(entries.map((e) => e.lock.release()));
      leading.clear();
      await Promise.all(
        entries.map((e) =>
          e.provider.close().catch((err: unknown) => {
            deps.log("error", "smpp unbind on close failed", { provider: e.name, err });
          }),
        ),
      );
    },
  };
}
