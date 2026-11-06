import type { SendRedis } from "./progress.js";

/** Just enough of ioredis for the send loop and the progress tracker, for unit tests. */
export function fakeRedis(): SendRedis & { data: Map<string, string>; ttls: Map<string, number> } {
  const data = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    data,
    ttls,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, String(value));
      return "OK";
    },
    async incrby(key, n) {
      const next = Number(data.get(key) ?? "0") + n;
      data.set(key, String(next));
      return next;
    },
    async mget(...keys) {
      return keys.map((k) => data.get(k) ?? null);
    },
    async expire(key, seconds) {
      ttls.set(key, seconds);
      return 1;
    },
  };
}
