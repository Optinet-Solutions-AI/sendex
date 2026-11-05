/**
 * The slice of the ioredis API these utilities use. Narrow on purpose so tests can pass a fake
 * and so a `Redis` or a `Cluster` client both satisfy it structurally.
 */
export interface RedisLike {
  /** `SET key value` with no expiry (always `"OK"` on a real server). */
  set(key: string, value: string): Promise<"OK" | null>;
  /** `SET key value PX ttl NX`: resolves `"OK"` when set, `null` when the key already exists. */
  set(key: string, value: string, px: "PX", ttlMs: number, nx: "NX"): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}
