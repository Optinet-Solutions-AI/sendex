import type { JobType } from "bullmq";

export interface QueueDepth {
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
}

/** Depth per queue name, as reported by `/health`. */
export type QueueDepths = Record<string, QueueDepth>;

/** The slice of a BullMQ `Queue` the health check needs, so tests can pass a fake. */
export interface DepthSource {
  name: string;
  getJobCounts(...types: JobType[]): Promise<Record<string, number>>;
}

const DEPTH_TYPES = ["waiting", "active", "failed", "delayed"] as const;

export async function queueDepths(
  queues: Iterable<DepthSource> | Record<string, DepthSource>,
): Promise<QueueDepths> {
  const list = Symbol.iterator in queues ? [...queues] : Object.values(queues);
  const depths: QueueDepths = {};
  await Promise.all(
    list.map(async (queue) => {
      const counts = await queue.getJobCounts(...DEPTH_TYPES);
      depths[queue.name] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    }),
  );
  return depths;
}

/** How long `/health` reuses the last queue depths. `QUEUE_DEPTH_CACHE_MS`, default 60 s. */
export const DEFAULT_QUEUE_DEPTH_CACHE_MS = 60_000;

/**
 * Wrap a depth reader so concurrent and repeated health probes share one Redis round trip
 * per `ttlMs`. Fly probes `/health` every 15 s and each depth read is four commands per queue
 * (ten queues with dead letters): uncached that is a third of a free Upstash plan's monthly
 * budget on probes alone. A failed read is not cached.
 */
export function cachedQueueDepths(
  read: () => Promise<QueueDepths>,
  ttlMs = DEFAULT_QUEUE_DEPTH_CACHE_MS,
  now: () => number = Date.now,
): () => Promise<QueueDepths> {
  let value: QueueDepths | null = null;
  let readAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<QueueDepths> | null = null;
  return async () => {
    if (value && now() - readAt < ttlMs) return value;
    if (inFlight) return inFlight;
    inFlight = read()
      .then((depths) => {
        value = depths;
        readAt = now();
        return depths;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
