import {
  type ConnectionOptions,
  type DefaultJobOptions,
  type JobsOptions,
  Queue,
  UnrecoverableError,
  Worker,
} from "bullmq";
import { type JobPayloads, parseJob } from "./jobs.js";
import { log as defaultLog, type Logger, serialiseError } from "./log.js";

/** Every BullMQ queue the worker owns, keyed by a code-friendly name. */
export const QUEUES = {
  send: "send",
  dlr: "dlr",
  clickIngest: "click-ingest",
  postbackIngest: "postback-ingest",
  scheduledSend: "scheduled-send",
} as const;

export type QueueKey = keyof typeof QUEUES;
export type QueueName = (typeof QUEUES)[QueueKey];

export const QUEUE_KEYS: readonly QueueKey[] = [
  "send",
  "dlr",
  "clickIngest",
  "postbackIngest",
  "scheduledSend",
];

/** Retry three times, 2s / 4s / 8s apart, and keep a bounded history for inspection. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} satisfies DefaultJobOptions;

/** A job that has used every attempt is copied here with its failure reason. Never processed. BullMQ forbids ":" in queue names, hence the dash. */
export function deadLetterQueueName(name: string): string {
  return `${name}-dead`;
}

// ---------------------------------------------------------------------------
// Queues (producers)
// ---------------------------------------------------------------------------

export type Queues = { [K in QueueKey]: Queue<JobPayloads[K]> };

export interface CreateQueuesOptions {
  defaultJobOptions?: DefaultJobOptions;
  /** Redis key prefix; lets tests isolate their keys. BullMQ defaults to "bull". */
  prefix?: string;
  log?: Logger;
}

export function createQueues(connection: ConnectionOptions, options: CreateQueuesOptions = {}) {
  const log = options.log ?? defaultLog;
  const defaultJobOptions = options.defaultJobOptions ?? DEFAULT_JOB_OPTIONS;

  function make<K extends QueueKey>(key: K): Queue<JobPayloads[K]> {
    const queue = new Queue<JobPayloads[K]>(QUEUES[key], {
      connection,
      defaultJobOptions,
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
    });
    queue.on("error", (err) => log("error", "queue error", { queue: QUEUES[key], err }));
    return queue;
  }

  const queues: Queues = {
    send: make("send"),
    dlr: make("dlr"),
    clickIngest: make("clickIngest"),
    postbackIngest: make("postbackIngest"),
    scheduledSend: make("scheduledSend"),
  };
  return queues;
}

export async function closeQueues(queues: Record<string, Queue>): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}

// ---------------------------------------------------------------------------
// Worker settings
// ---------------------------------------------------------------------------

export interface WorkerSettings {
  /** Parallel send-lap jobs per worker process. `SEND_CONCURRENCY`, default 5. */
  sendConcurrency: number;
  /** Send-lap jobs started per second per worker process. `SEND_RATE_PER_SECOND`, default 50. */
  sendRatePerSecond: number;
  /** Parallel jobs on the dlr, click and postback ingest queues. `INGEST_CONCURRENCY`, default 5. */
  ingestConcurrency: number;
}

type Env = Record<string, string | undefined>;

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export function workerSettingsFromEnv(env: Env = process.env): WorkerSettings {
  return {
    sendConcurrency: positiveInt(env, "SEND_CONCURRENCY", 5),
    sendRatePerSecond: positiveInt(env, "SEND_RATE_PER_SECOND", 50),
    ingestConcurrency: positiveInt(env, "INGEST_CONCURRENCY", 5),
  };
}

// ---------------------------------------------------------------------------
// Handlers and processors
// ---------------------------------------------------------------------------

/** What a handler can see of the BullMQ job besides its parsed payload. */
export interface JobMeta {
  id?: string | undefined;
  name: string;
  attemptsMade: number;
}

export type JobHandler<K extends QueueKey> = (
  payload: JobPayloads[K],
  job: JobMeta,
) => Promise<void>;
export type JobHandlers = { [K in QueueKey]: JobHandler<K> };

/**
 * Wrap a handler so the payload is validated first. An invalid payload cannot become
 * valid on retry, so it fails as unrecoverable and goes straight to the dead-letter queue.
 */
export function createProcessor<K extends QueueKey>(queue: K, handler: JobHandler<K>) {
  return async (job: JobMeta & { data: unknown }): Promise<void> => {
    let payload: JobPayloads[K];
    try {
      payload = parseJob(queue, job.data);
    } catch (err) {
      throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
    }
    await handler(payload, job);
  };
}

// ---------------------------------------------------------------------------
// Dead letters
// ---------------------------------------------------------------------------

export interface DeadLetterEntry {
  queue: QueueName;
  jobId: string | null;
  name: string;
  data: unknown;
  attemptsMade: number;
  failedReason: string;
  errorName: string;
  enqueuedAt: string;
  deadLetteredAt: string;
}

export interface FailedJobLike {
  attemptsMade: number;
  opts: Pick<JobsOptions, "attempts">;
}

/** True when BullMQ will not retry the job again: attempts exhausted, or the error is unrecoverable. */
export function shouldDeadLetter(job: FailedJobLike, err: Error): boolean {
  if (err instanceof UnrecoverableError || err.name === "UnrecoverableError") return true;
  const attempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= attempts;
}

export interface DeadLetterSource {
  id?: string | undefined;
  name: string;
  data: unknown;
  attemptsMade: number;
  failedReason?: string | undefined;
  timestamp: number;
}

export function buildDeadLetterEntry(
  queue: QueueName,
  job: DeadLetterSource,
  err: Error,
  now: Date,
): DeadLetterEntry {
  return {
    queue,
    jobId: job.id ?? null,
    name: job.name,
    data: job.data,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason || err.message,
    errorName: err.name,
    enqueuedAt: new Date(job.timestamp).toISOString(),
    deadLetteredAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Workers (consumers)
// ---------------------------------------------------------------------------

export type Workers = { [K in QueueKey]: Worker<JobPayloads[K]> };
export type DeadLetterQueues = { [K in QueueKey]: Queue<DeadLetterEntry> };

export interface WorkerSet {
  workers: Workers;
  deadLetterQueues: DeadLetterQueues;
  /** Stop taking jobs, let in-flight jobs finish, then close the dead-letter queues. */
  close(): Promise<void>;
}

export interface CreateWorkersOptions {
  settings?: WorkerSettings;
  prefix?: string;
  log?: Logger;
  /** Called after a job has been copied to its dead-letter queue. */
  onDeadLetter?: (entry: DeadLetterEntry) => void;
}

export function createWorkers(
  connection: ConnectionOptions,
  handlers: JobHandlers,
  options: CreateWorkersOptions = {},
): WorkerSet {
  const log = options.log ?? defaultLog;
  const settings = options.settings ?? workerSettingsFromEnv();
  const prefix = options.prefix === undefined ? {} : { prefix: options.prefix };

  function makeDead(key: QueueKey): Queue<DeadLetterEntry> {
    const dead = new Queue<DeadLetterEntry>(deadLetterQueueName(QUEUES[key]), {
      connection,
      defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false },
      ...prefix,
    });
    dead.on("error", (err) =>
      log("error", "dead-letter queue error", { queue: dead.name, err: serialiseError(err) }),
    );
    return dead;
  }

  const deadLetterQueues: DeadLetterQueues = {
    send: makeDead("send"),
    dlr: makeDead("dlr"),
    clickIngest: makeDead("clickIngest"),
    postbackIngest: makeDead("postbackIngest"),
    scheduledSend: makeDead("scheduledSend"),
  };

  function make<K extends QueueKey>(
    key: K,
    workerOptions: { concurrency: number; limiter?: { max: number; duration: number } },
  ): Worker<JobPayloads[K]> {
    const name = QUEUES[key];
    const worker = new Worker<JobPayloads[K]>(name, createProcessor(key, handlers[key]), {
      connection,
      ...workerOptions,
      ...prefix,
    });

    worker.on("error", (err) => log("error", "worker error", { queue: name, err }));
    worker.on("failed", (job, err) => {
      log("warn", "job failed", {
        queue: name,
        jobId: job?.id ?? null,
        attemptsMade: job?.attemptsMade ?? null,
        err: serialiseError(err),
      });
      if (!job || !shouldDeadLetter(job, err)) return;
      const entry = buildDeadLetterEntry(name, job, err, new Date());
      deadLetterQueues[key]
        .add("dead", entry)
        .then(() => {
          log("error", "job dead-lettered", {
            queue: name,
            jobId: entry.jobId,
            attemptsMade: entry.attemptsMade,
            failedReason: entry.failedReason,
          });
          options.onDeadLetter?.(entry);
        })
        .catch((addErr: unknown) =>
          log("error", "dead-letter enqueue failed", {
            queue: name,
            jobId: entry.jobId,
            err: addErr,
          }),
        );
    });
    return worker;
  }

  const workers: Workers = {
    send: make("send", {
      concurrency: settings.sendConcurrency,
      limiter: { max: settings.sendRatePerSecond, duration: 1000 },
    }),
    dlr: make("dlr", { concurrency: settings.ingestConcurrency }),
    clickIngest: make("clickIngest", { concurrency: settings.ingestConcurrency }),
    postbackIngest: make("postbackIngest", { concurrency: settings.ingestConcurrency }),
    scheduledSend: make("scheduledSend", { concurrency: 1 }),
  };

  return {
    workers,
    deadLetterQueues,
    async close() {
      await Promise.all(Object.values(workers).map((w) => w.close()));
      await closeQueues(deadLetterQueues);
    },
  };
}
