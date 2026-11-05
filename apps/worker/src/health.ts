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
