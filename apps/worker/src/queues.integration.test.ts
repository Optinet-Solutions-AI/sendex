/**
 * Runs against a real Redis when REDIS_URL is set and reachable, otherwise the suite is
 * skipped so CI without Redis still passes:
 *
 *   REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @sendex/worker test
 */
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SendLapJob } from "./jobs.js";
import { createLogger } from "./log.js";
import {
  type CreateQueuesOptions,
  closeQueues,
  createQueues,
  createWorkers,
  type DeadLetterEntry,
  deadLetterQueueName,
  type JobHandlers,
  type Queues,
  type WorkerSet,
  workerSettingsFromEnv,
} from "./queues.js";

const redisUrl = process.env.REDIS_URL;

async function redisReachable(url: string): Promise<boolean> {
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

const reachable = redisUrl !== undefined && (await redisReachable(redisUrl));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const quietLog = createLogger({ write: () => undefined });

const noopHandlers: JobHandlers = {
  send: async () => undefined,
  dlr: async () => undefined,
  clickIngest: async () => undefined,
  postbackIngest: async () => undefined,
  scheduledSend: async () => undefined,
  smsTests: async () => undefined,
  verify: async () => undefined,
};

describe.skipIf(!reachable)("queues (integration, needs Redis)", () => {
  const url = redisUrl ?? "";
  let connection: Redis;
  let cleanups: Array<() => Promise<void>> = [];
  let run = 0;

  beforeAll(() => {
    connection = new Redis(url, { maxRetriesPerRequest: null });
  });

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  afterAll(async () => {
    await connection.quit();
  });

  /** Fresh queues and workers under a unique key prefix, torn down (and obliterated) after the test. */
  function setup(
    handlers: Partial<JobHandlers>,
    queueOptions: Omit<CreateQueuesOptions, "prefix" | "log"> = {},
  ): { queues: Queues; workerSet: WorkerSet; deadLetters: Promise<DeadLetterEntry> } {
    run += 1;
    const prefix = `sendex-test-${process.pid}-${Date.now()}-${run}`;
    const dead = deferred<DeadLetterEntry>();
    const queues = createQueues(connection, { ...queueOptions, prefix, log: quietLog });
    const workerSet = createWorkers(
      connection,
      { ...noopHandlers, ...handlers },
      {
        prefix,
        log: quietLog,
        settings: workerSettingsFromEnv({}),
        onDeadLetter: dead.resolve,
      },
    );
    cleanups.push(async () => {
      await workerSet.close();
      await Promise.all(
        [...Object.values(queues), ...Object.values(workerSet.deadLetterQueues)].map((q) =>
          q.obliterate({ force: true }),
        ),
      );
      await closeQueues(queues);
    });
    return { queues, workerSet, deadLetters: dead.promise };
  }

  it("delivers a SendLapJob to the handler as a parsed payload", async () => {
    const received = deferred<{ payload: SendLapJob; jobId: string | undefined }>();
    const { queues, workerSet } = setup({
      send: async (payload, meta) => received.resolve({ payload, jobId: meta.id }),
    });
    const completed = deferred<string | undefined>();
    workerSet.workers.send.once("completed", (job) => completed.resolve(job.id));

    const payload: SendLapJob = {
      organisationId: "org_1",
      campaignId: "cmp_1",
      lapId: "lap_1",
      idempotencyKey: "cmp_1:lap_1",
    };
    const job = await queues.send.add("send-lap", payload);
    const got = await withTimeout(received.promise, 5000, "the send handler");

    expect(got.payload).toEqual(payload);
    expect(got.jobId).toBe(job.id);
    expect(await withTimeout(completed.promise, 5000, "job completion")).toBe(job.id);
    expect(await queues.send.getJobCounts("completed", "failed")).toMatchObject({
      completed: 1,
      failed: 0,
    });
  });

  it("moves an invalid payload to send-dead without running the handler", async () => {
    let handlerCalls = 0;
    const { queues, workerSet, deadLetters } = setup(
      {
        send: async () => {
          handlerCalls += 1;
        },
      },
      { defaultJobOptions: { attempts: 1 } },
    );

    const invalid = { organisationId: "org_1", campaignId: "cmp_1" } as unknown as SendLapJob;
    const job = await queues.send.add("send-lap", invalid);
    const entry = await withTimeout(deadLetters, 5000, "the dead-letter entry");

    expect(handlerCalls).toBe(0);
    expect(entry).toMatchObject({
      queue: "send",
      jobId: job.id,
      name: "send-lap",
      data: invalid,
      attemptsMade: 1,
      errorName: "UnrecoverableError",
    });
    expect(entry.failedReason).toMatch(/Invalid "send" job payload/);

    const deadQueue = workerSet.deadLetterQueues.send;
    expect(deadQueue.name).toBe(deadLetterQueueName("send"));
    const waiting = await deadQueue.getJobs(["waiting"]);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.data).toEqual(entry);
  });

  it("dead-letters a job only after every attempt has failed", async () => {
    let handlerCalls = 0;
    const { queues, workerSet, deadLetters } = setup(
      {
        scheduledSend: async () => {
          handlerCalls += 1;
          throw new Error("carrier down");
        },
      },
      { defaultJobOptions: { attempts: 2, backoff: { type: "fixed", delay: 10 } } },
    );

    await queues.scheduledSend.add("tick", { kind: "dispatch-laps" });
    const entry = await withTimeout(deadLetters, 5000, "the dead-letter entry");

    expect(handlerCalls).toBe(2);
    expect(entry).toMatchObject({
      queue: "scheduled-send",
      attemptsMade: 2,
      failedReason: "carrier down",
      errorName: "Error",
    });
    expect(await workerSet.deadLetterQueues.scheduledSend.getJobCounts("waiting")).toMatchObject({
      waiting: 1,
    });
    // Only the one dead-letter entry: the first failure was retried, not copied.
    expect(await workerSet.deadLetterQueues.scheduledSend.count()).toBe(1);
  });
});
