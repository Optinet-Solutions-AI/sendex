import { scheduleDue } from "@sendex/core";
import type { SmsTestJob } from "../jobs.js";
import type { Logger } from "../log.js";

/**
 * The tests dispatcher rides on the scheduled tick: queued single tests are claimed and
 * enqueued at once; scheduled ones fire when their day and 15-minute UTC slot match, once
 * per slot.
 */

export interface TestDispatchStore {
  listQueuedTests(): Promise<Array<{ id: string; organisationId: string }>>;
  listScheduledTests(): Promise<
    Array<{
      id: string;
      organisationId: string;
      days: number[];
      times: string[];
      lastSlot: string | null;
    }>
  >;
  claimTest(id: string, slotKey: string | null): Promise<boolean>;
}

export interface TestQueueLike {
  add(name: string, data: SmsTestJob, opts?: { jobId: string }): Promise<unknown>;
}

export interface TestDispatcherDeps {
  store: TestDispatchStore;
  queue: TestQueueLike;
  log: Logger;
  now?: () => Date;
}

export function testJobId(testId: string, slotKey: string | null): string {
  return slotKey ? `sms-test:${testId}:${slotKey}` : `sms-test:${testId}`;
}

export async function dispatchDueTests(deps: TestDispatcherDeps): Promise<{ enqueued: number }> {
  const now = deps.now?.() ?? new Date();
  let enqueued = 0;
  const enqueue = async (id: string, organisationId: string, slotKey: string | null) => {
    if (!(await deps.store.claimTest(id, slotKey))) return;
    await deps.queue.add(
      "sms-test",
      { organisationId, testId: id, slotKey },
      { jobId: testJobId(id, slotKey) },
    );
    enqueued += 1;
    deps.log("info", "sms test dispatched", { testId: id, organisationId, slotKey });
  };
  for (const t of await deps.store.listQueuedTests()) await enqueue(t.id, t.organisationId, null);
  for (const t of await deps.store.listScheduledTests()) {
    const slot = scheduleDue({ days: t.days, times: t.times }, now, t.lastSlot);
    if (slot) await enqueue(t.id, t.organisationId, slot.key);
  }
  return { enqueued };
}
