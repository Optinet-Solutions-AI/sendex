import type { RedisLike } from "./redis-like.js";
import { LEADER_RELEASE_SCRIPT, LEADER_RENEW_SCRIPT, RATE_LIMIT_SCRIPT } from "./scripts.js";

/**
 * In-memory stand-in for the ioredis slice in `RedisLike`, for unit tests. It implements
 * `SET` (plain and `PX ... NX`), `GET`, `DEL` and `EVAL` of the scripts in `scripts.ts` by
 * recognising the script text and running the same logic in JS. Expiry is driven by the
 * injected clock so tests control time; key access is lazily expired like Redis does.
 */
export interface FakeRedisOptions {
  /** Clock used for TTLs; defaults to `Date.now`. */
  now?: () => number;
}

export interface FakeRedis extends RedisLike {
  /** Every command issued, oldest first, for assertions on what the code under test sent. */
  readonly calls: ReadonlyArray<ReadonlyArray<string | number>>;
  /** Make the next command reject with `error` (one shot). */
  failNext(error: Error): void;
  /** Milliseconds left on a key, `-1` for no expiry, `-2` when absent (like `PTTL`). */
  pttl(key: string): number;
  /** Sorted-set members with their scores, oldest first (empty when absent). */
  zrange(key: string): Array<{ member: string; score: number }>;
  /** Drop every key. */
  flush(): void;
}

type Entry =
  | { kind: "string"; value: string; expiresAt: number | null }
  | { kind: "zset"; members: Map<string, number>; expiresAt: number | null };

class UnknownScriptError extends Error {
  constructor(script: string) {
    super(`fake redis: unknown script:\n${script}`);
    this.name = "UnknownScriptError";
  }
}

export function createFakeRedis(options: FakeRedisOptions = {}): FakeRedis {
  const now = options.now ?? (() => Date.now());
  const store = new Map<string, Entry>();
  const calls: Array<Array<string | number>> = [];
  let pendingFailure: Error | null = null;

  function record(...call: Array<string | number>): void {
    calls.push(call);
    if (pendingFailure) {
      const error = pendingFailure;
      pendingFailure = null;
      throw error;
    }
  }

  function live(key: string): Entry | undefined {
    const entry = store.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }

  function stringValue(key: string): string | null {
    const entry = live(key);
    return entry?.kind === "string" ? entry.value : null;
  }

  function pexpire(key: string, ttlMs: number): number {
    const entry = live(key);
    if (!entry) return 0;
    entry.expiresAt = now() + ttlMs;
    return 1;
  }

  function del(key: string): number {
    if (!live(key)) return 0;
    store.delete(key);
    return 1;
  }

  function runScript(script: string, keys: string[], args: Array<string | number>): unknown {
    const key = keys[0];
    if (key === undefined) throw new Error("fake redis: script needs a key");
    if (script === LEADER_RENEW_SCRIPT) {
      return stringValue(key) === String(args[0]) ? pexpire(key, Number(args[1])) : 0;
    }
    if (script === LEADER_RELEASE_SCRIPT) {
      return stringValue(key) === String(args[0]) ? del(key) : 0;
    }
    if (script === RATE_LIMIT_SCRIPT) {
      const at = Number(args[0]);
      const window = Number(args[1]);
      const max = Number(args[2]);
      const member = String(args[3]);
      const existing = live(key);
      const entry: Extract<Entry, { kind: "zset" }> =
        existing?.kind === "zset"
          ? existing
          : { kind: "zset", members: new Map(), expiresAt: null };
      for (const [m, score] of entry.members) if (score <= at - window) entry.members.delete(m);
      let count = entry.members.size;
      let allowed = 0;
      if (count < max) {
        entry.members.set(member, at);
        count += 1;
        allowed = 1;
      }
      entry.expiresAt = now() + window;
      store.set(key, entry);
      const oldest = Math.min(...entry.members.values());
      const reset = entry.members.size > 0 ? oldest + window - at : window;
      return [allowed, count, reset];
    }
    throw new UnknownScriptError(script);
  }

  const fake: FakeRedis = {
    calls,
    failNext(error) {
      pendingFailure = error;
    },
    pttl(key) {
      const entry = live(key);
      if (!entry) return -2;
      return entry.expiresAt === null ? -1 : entry.expiresAt - now();
    },
    zrange(key) {
      const entry = live(key);
      if (entry?.kind !== "zset") return [];
      return [...entry.members.entries()]
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => a.score - b.score);
    },
    flush() {
      store.clear();
    },
    async set(key: string, value: string, px?: "PX", ttlMs?: number, nx?: "NX") {
      if (px === undefined) {
        record("SET", key, value);
        store.set(key, { kind: "string", value, expiresAt: null });
        return "OK";
      }
      record("SET", key, value, "PX", ttlMs ?? 0, nx ?? "");
      if (nx === "NX" && live(key)) return null;
      store.set(key, { kind: "string", value, expiresAt: now() + (ttlMs ?? 0) });
      return "OK";
    },
    async get(key) {
      record("GET", key);
      return stringValue(key);
    },
    async del(key) {
      record("DEL", key);
      return del(key);
    },
    async eval(script, numKeys, ...args) {
      record("EVAL", script, numKeys, ...args);
      const keys = args.slice(0, numKeys).map(String);
      return runScript(script, keys, args.slice(numKeys));
    },
  };
  return fake;
}
