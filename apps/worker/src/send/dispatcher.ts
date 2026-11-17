import type { SendingStore } from "@sendex/db";
import type { Queue } from "bullmq";
import type { ScheduledSendJob, SendLapJob } from "../jobs.js";
import type { Logger } from "../log.js";

export const DISPATCHER_SCHEDULER_ID = "dispatch-laps";

/**
 * Register (or update) the repeatable dispatcher tick on the `scheduled-send` queue.
 * BullMQ keeps one scheduler per id, so every worker process can call this at boot.
 */
export async function scheduleLapDispatcher(
  queue: Queue<ScheduledSendJob>,
  everyMs: number,
): Promise<void> {
  await queue.upsertJobScheduler(
    DISPATCHER_SCHEDULER_ID,
    { every: everyMs },
    { name: DISPATCHER_SCHEDULER_ID, data: { kind: "dispatch-laps" } },
  );
}

/** The idempotency key carried by a lap's `SendLapJob` payload. */
export function lapIdempotencyKey(lapId: string): string {
  return `lap:${lapId}`;
}

/**
 * The BullMQ job id of a lap's send job: one lap, one job, however often the dispatcher
 * runs. BullMQ forbids ":" in custom ids, hence the dash (like the `-dead` queue names).
 */
export function lapJobId(lapId: string): string {
  return `lap-${lapId}`;
}

/** The slice of `Queue<SendLapJob>` the dispatcher needs. */
export interface SendQueueLike {
  add(name: string, data: SendLapJob, opts?: { jobId: string }): Promise<unknown>;
}

export interface DispatcherDeps {
  store: Pick<SendingStore, "claimQueuedLaps" | "unclaimLap" | "completeIdleCampaigns">;
  sendQueue: SendQueueLike;
  log: Logger;
  now?: () => Date;
}

export interface DispatchResult {
  claimed: number;
  enqueued: number;
  failed: number;
  /** Campaigns marked completed on this tick because none of their laps is left to send. */
  completed: number;
}

/**
 * One dispatcher tick (D2-04): atomically move every dispatchable `queued` lap to
 * `sending` and enqueue its `SendLapJob`. The job id is `lap:<lapId>`, so a lap that
 * already has a job (waiting, active or kept after completion) is never enqueued twice.
 * A lap whose job cannot be added goes back to `queued` for the next tick.
 *
 * The tick also marks campaigns with nothing left to send as completed (D4-23). That check
 * runs on every tick, not only when a lap finishes, so a campaign whose last lap was
 * cancelled or whose worker died is still picked up; a failure there never fails the dispatch.
 */
export async function dispatchQueuedLaps(deps: DispatcherDeps): Promise<DispatchResult> {
  const now = deps.now?.() ?? new Date();
  const claimed = await deps.store.claimQueuedLaps(now);
  let enqueued = 0;
  let failed = 0;
  for (const lap of claimed) {
    const payload: SendLapJob = {
      organisationId: lap.organisationId,
      campaignId: lap.campaignId,
      lapId: lap.id,
      idempotencyKey: lapIdempotencyKey(lap.id),
    };
    try {
      await deps.sendQueue.add("send-lap", payload, { jobId: lapJobId(lap.id) });
      enqueued += 1;
      deps.log("info", "lap dispatched", {
        lapId: lap.id,
        campaignId: lap.campaignId,
        organisationId: lap.organisationId,
      });
    } catch (err) {
      failed += 1;
      deps.log("error", "lap enqueue failed, lap returned to queued", { lapId: lap.id, err });
      await deps.store.unclaimLap(lap.id);
    }
  }
  let completed = 0;
  try {
    const ids = await deps.store.completeIdleCampaigns();
    completed = ids.length;
    if (completed > 0) deps.log("info", "campaigns completed", { campaignIds: ids });
  } catch (err) {
    deps.log("warn", "completed check failed, will retry on the next tick", { err });
  }
  if (failed > 0) {
    throw new Error(`${failed} of ${claimed.length} laps could not be enqueued`);
  }
  return { claimed: claimed.length, enqueued, failed, completed };
}
