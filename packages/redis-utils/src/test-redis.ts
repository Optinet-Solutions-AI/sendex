/**
 * Shared setup for the integration suites. They run against a real Redis when REDIS_URL is
 * set and reachable, otherwise they skip so CI without Redis still passes:
 *
 *   REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @sendex/redis-utils test
 */
import { Redis } from "ioredis";

export const redisUrl = process.env.REDIS_URL;

export async function redisReachable(url: string): Promise<boolean> {
  const probe = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
  });
  try {
    await probe.connect();
    return (await probe.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

export const reachable = redisUrl !== undefined && (await redisReachable(redisUrl));

export function connect(): Redis {
  return new Redis(redisUrl ?? "", { maxRetriesPerRequest: null });
}

let run = 0;

/** A key prefix no other test run shares, so suites can run in parallel against one server. */
export function uniquePrefix(name: string): string {
  run += 1;
  return `sendex-test:${name}:${process.pid}:${Date.now()}:${run}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `check` until it is true or `timeoutMs` passes. */
export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}
