import { DelayedError, UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";
import {
  buildDeadLetterEntry,
  createProcessor,
  DEFAULT_JOB_OPTIONS,
  deadLetterQueueName,
  QUEUES,
  shouldDeadLetter,
  workerSettingsFromEnv,
} from "./queues.js";

describe("QUEUES", () => {
  it("names every queue", () => {
    expect(QUEUES).toEqual({
      send: "send",
      dlr: "dlr",
      clickIngest: "click-ingest",
      postbackIngest: "postback-ingest",
      scheduledSend: "scheduled-send",
      smsTests: "sms-tests",
    });
  });

  it("derives the dead-letter queue name", () => {
    expect(deadLetterQueueName("send")).toBe("send-dead");
    expect(deadLetterQueueName("click-ingest")).toBe("click-ingest-dead");
  });
});

describe("DEFAULT_JOB_OPTIONS", () => {
  it("retries three times with exponential backoff and bounded history", () => {
    expect(DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  });
});

describe("workerSettingsFromEnv", () => {
  it("falls back to the defaults", () => {
    expect(workerSettingsFromEnv({})).toEqual({
      sendConcurrency: 5,
      sendRatePerSecond: 50,
      ingestConcurrency: 5,
      lapPollMs: 5000,
      pauseRetryMs: 10_000,
      drainDelaySeconds: 30,
    });
  });

  it("reads positive integers from the environment", () => {
    expect(
      workerSettingsFromEnv({
        SEND_CONCURRENCY: "12",
        SEND_RATE_PER_SECOND: "200",
        INGEST_CONCURRENCY: "3",
        LAP_POLL_MS: "1000",
        PAUSE_RETRY_MS: "250",
        DRAIN_DELAY_SECONDS: "7",
      }),
    ).toEqual({
      sendConcurrency: 12,
      sendRatePerSecond: 200,
      ingestConcurrency: 3,
      lapPollMs: 1000,
      pauseRetryMs: 250,
      drainDelaySeconds: 7,
    });
  });

  it("rejects values that are not positive integers", () => {
    expect(() => workerSettingsFromEnv({ SEND_CONCURRENCY: "0" })).toThrowError(/SEND_CONCURRENCY/);
    expect(() => workerSettingsFromEnv({ LAP_POLL_MS: "-1" })).toThrowError(/LAP_POLL_MS/);
    expect(() => workerSettingsFromEnv({ SEND_RATE_PER_SECOND: "fast" })).toThrowError(
      /SEND_RATE_PER_SECOND/,
    );
    expect(() => workerSettingsFromEnv({ INGEST_CONCURRENCY: "1.5" })).toThrowError(
      /INGEST_CONCURRENCY/,
    );
  });
});

describe("shouldDeadLetter", () => {
  it("is true once every attempt has been used", () => {
    expect(shouldDeadLetter({ attemptsMade: 3, opts: { attempts: 3 } }, new Error("x"))).toBe(true);
    expect(shouldDeadLetter({ attemptsMade: 2, opts: { attempts: 3 } }, new Error("x"))).toBe(
      false,
    );
  });

  it("treats a missing attempts option as a single attempt", () => {
    expect(shouldDeadLetter({ attemptsMade: 1, opts: {} }, new Error("x"))).toBe(true);
    expect(shouldDeadLetter({ attemptsMade: 0, opts: {} }, new Error("x"))).toBe(false);
  });

  it("is true for an unrecoverable error whatever the attempt count", () => {
    expect(
      shouldDeadLetter({ attemptsMade: 1, opts: { attempts: 3 } }, new UnrecoverableError("bad")),
    ).toBe(true);
  });
});

describe("buildDeadLetterEntry", () => {
  it("copies the job with its failure reason", () => {
    const entry = buildDeadLetterEntry(
      "send",
      {
        id: "42",
        name: "send-lap",
        data: { organisationId: "org_1" },
        attemptsMade: 3,
        failedReason: "boom",
        timestamp: 1_700_000_000_000,
      },
      new Error("boom"),
      new Date("2026-11-06T10:00:00.000Z"),
    );
    expect(entry).toEqual({
      queue: "send",
      jobId: "42",
      name: "send-lap",
      data: { organisationId: "org_1" },
      attemptsMade: 3,
      failedReason: "boom",
      errorName: "Error",
      enqueuedAt: "2023-11-14T22:13:20.000Z",
      deadLetteredAt: "2026-11-06T10:00:00.000Z",
    });
  });

  it("prefers the thrown error's message when the job has no failed reason", () => {
    const entry = buildDeadLetterEntry(
      "dlr",
      { id: undefined, name: "dlr", data: null, attemptsMade: 1, timestamp: 0 },
      new UnrecoverableError("invalid payload"),
      new Date(0),
    );
    expect(entry.jobId).toBeNull();
    expect(entry.failedReason).toBe("invalid payload");
    expect(entry.errorName).toBe("UnrecoverableError");
  });
});

describe("createProcessor", () => {
  it("parses the payload and hands it to the handler with the job", async () => {
    const seen: unknown[] = [];
    const processor = createProcessor("scheduledSend", async (payload, job) => {
      seen.push(payload, job.id);
    });
    const job = {
      id: "7",
      name: "scheduled-send",
      attemptsMade: 0,
      data: { kind: "dispatch-laps" },
    };
    await processor(job);
    expect(seen).toEqual([{ kind: "dispatch-laps" }, "7"]);
  });

  it("gives the handler a delay() that parks the job and throws DelayedError", async () => {
    const moved: Array<{ timestamp: number; token: string | undefined }> = [];
    const processor = createProcessor("scheduledSend", async (_payload, job) => {
      if (!job.delay) throw new Error("expected delay()");
      await job.delay(5000);
      throw new Error("delay() must not return");
    });
    const job = {
      id: "9",
      name: "scheduled-send",
      attemptsMade: 0,
      data: { kind: "dispatch-laps" },
      moveToDelayed: async (timestamp: number, token?: string) => {
        moved.push({ timestamp, token });
      },
    };
    const before = Date.now();
    await expect(processor(job, "tok")).rejects.toBeInstanceOf(DelayedError);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.token).toBe("tok");
    expect(moved[0]?.timestamp).toBeGreaterThanOrEqual(before + 5000);
  });

  it("offers no delay() when the job cannot be moved", async () => {
    let hadDelay: boolean | null = null;
    const processor = createProcessor("scheduledSend", async (_payload, job) => {
      hadDelay = job.delay !== undefined;
    });
    await processor({ id: "10", name: "x", attemptsMade: 0, data: { kind: "dispatch-laps" } });
    expect(hadDelay).toBe(false);
  });

  it("throws an UnrecoverableError for an invalid payload so it is not retried", async () => {
    const processor = createProcessor("scheduledSend", async () => {
      throw new Error("handler must not run");
    });
    await expect(
      processor({ id: "8", name: "scheduled-send", attemptsMade: 0, data: { nope: true } }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
