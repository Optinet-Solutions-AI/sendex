# Services and queues

The worker (`apps/worker`) is the only service that runs background work. It owns every
BullMQ queue, the HTTP health endpoint and, in later cards, the public API and postback intake.
Producers are the web app (campaign launch, scheduling), the links service (click batches) and
the worker itself (scheduler ticks, provider receipts). Only the worker consumes.

Cards: D2-01 (provider registry), D2-02 (queues, workers, health, logging), D2-04 to D2-07
(send loop, dispatcher, progress, internal API: see `sending-engine.md`).

## Processes

| Process | Role | Code |
| --- | --- | --- |
| `apps/worker` HTTP | `GET /health`, `/internal/*` (progress, laps); public API and postbacks later | `src/app.ts`, `src/internal-api.ts`, `src/index.ts` |
| `apps/worker` workers | One BullMQ `Worker` per queue, started at boot when `REDIS_URL` is set | `src/queues.ts`, `src/handlers.ts` |
| `apps/worker` dispatcher | Repeatable `scheduled-send` job every `LAP_POLL_MS`, registered at boot | `src/send/dispatcher.ts` |

Without `REDIS_URL` the process still serves `/health` (reporting `redis: false`) but starts no
queues or workers. That keeps `pnpm dev` usable for the HTTP surface alone. Without
`DATABASE_URL` the workers run but the `send` and `scheduled-send` handlers are logging stubs.

## Queues

Queue names live in `QUEUES` in `apps/worker/src/queues.ts`; never type a queue name by hand.

| Key | Queue name | Payload | Produced by | Handler |
| --- | --- | --- | --- | --- |
| `send` | `send` | `SendLapJob` | the lap dispatcher (one job per claimed lap, job id `lap-<lapId>`) | `sendLap()`, D2-04 |
| `dlr` | `dlr` | `DlrJob` | `subscribeDeliveryReceipts()` at boot: one job per SMPP `deliver_sm` receipt (HTTP webhooks later) | `createDlrHandler()`, D3-01 (see `sending-engine.md`) |
| `clickIngest` | `click-ingest` | `ClickIngestJob` | links service batches | stub, D2-12 |
| `postbackIngest` | `postback-ingest` | `PostbackIngestJob` | postback endpoint | stub, D2-14 |
| `scheduledSend` | `scheduled-send` | `ScheduledSendJob` | the repeatable dispatcher tick (`upsertJobScheduler`, every `LAP_POLL_MS`) | `dispatchQueuedLaps()`, D2-04, then the receipt expiry sweep (at most once per `DLR_EXPIRY_POLL_MS`), D3-01 |

Each queue has a dead-letter twin named `<queue>-dead` (`send-dead`, `click-ingest-dead`, ...).
BullMQ forbids `:` in queue names, so the dash replaces the `<queue>:dead` convention from the card.

## Payloads

Schemas are Zod objects in `apps/worker/src/jobs.ts`. The processor parses `job.data` with the
queue's schema before any handler runs, so handlers only ever see typed, validated payloads.
Use the `parse*Job` helpers (or `parseJob(key, data)`) when you need to validate outside a worker;
they throw `Invalid "<queue>" job payload: ...` with the Zod issues.

```ts
SendLapJob         { organisationId, campaignId, lapId, idempotencyKey }   // idempotencyKey = "lap:<lapId>"
DlrJob             { provider, raw }                       // provider: registry name (routes.provider); raw: the JSON-safe receipt the provider parses again
ClickIngestJob     { clicks: [{ shortCode, clickedAt, ip, userAgent }, ...] }  // at least one
PostbackIngestJob  { eventKey, type: "registration" | "sale", dynamicId, valueMicro?, params }
ScheduledSendJob   { kind: "dispatch-laps" }               // the dispatcher tick; carries no ids
```

`idempotencyKey` on `SendLapJob` is `lap:<lapId>`; the BullMQ job id is `lap-<lapId>` because
BullMQ forbids `:` in custom ids. Inside the lap, every message and ledger entry carries its own
key (`<lapId>:<contactId>`, `msg:<messageId>`, `refund:<messageId>`; AGENTS.md rule 6).
`ScheduledSendJob` changed in D2-04: it used to name a campaign, now the dispatcher reads the
`laps` table instead, so scheduled campaigns need no job of their own. `valueMicro` is the sale
value in micro-units of the organisation currency.

## Retry policy

`DEFAULT_JOB_OPTIONS` applies to every job added through `createQueues()`:

| Option | Value | Effect |
| --- | --- | --- |
| `attempts` | 3 | A job runs at most three times |
| `backoff` | exponential, 2000 ms | Retries after 2 s, then 4 s |
| `removeOnComplete` | 1000 | Keep the last 1000 completed jobs per queue for inspection |
| `removeOnFail` | 5000 | Keep the last 5000 failed jobs per queue |

A handler that throws a plain `Error` is retried. A handler that throws BullMQ's
`UnrecoverableError` is not; the job fails at once. An invalid payload fails this way, since
retrying cannot make it valid.

A handler can also park its job without using an attempt: `JobMeta.delay(ms)` calls BullMQ's
`moveToDelayed` and throws `DelayedError`, so the job comes back after `ms`. The send loop uses
it while a campaign is paused. `delay` is absent when a handler is called outside a worker
(unit tests), in which case the send loop simply returns.

## Dead letters

When a job will not be retried again, the worker's `failed` listener copies it to the queue's
`-dead` twin (`shouldDeadLetter()` in `queues.ts`: attempts exhausted, or the error is
unrecoverable). Nothing consumes dead-letter queues; entries sit in `waiting` until someone
inspects, requeues or deletes them. The entry is:

```ts
{
  queue: "send",                       // the source queue name
  jobId: "42",                         // source job id, null if unknown
  name: "send-lap",                    // source job name
  data: { ... },                       // the original payload, unchanged
  attemptsMade: 3,
  failedReason: "carrier down",        // job.failedReason, else the error message
  errorName: "Error",                  // "UnrecoverableError" for bad payloads
  enqueuedAt: "2026-11-06T10:00:00.000Z",
  deadLetteredAt: "2026-11-06T10:00:14.000Z",
}
```

Dead-letter jobs are added with `attempts: 1` and are never auto-removed. The `/health` response
counts them under `<queue>-dead.waiting`, so alerting on a non-zero value is enough to notice.
A failed copy to the dead-letter queue is logged at `error` level with the job id; the original
job is still in the source queue's failed set (`removeOnFail` permitting).

## Workers

`createWorkers(connection, handlers, options)` starts one `Worker` per queue and returns the
workers, the dead-letter queues and a `close()` that stops taking jobs, waits for in-flight jobs,
then closes the dead-letter queues. Handlers are injected (`JobHandlers`), so unit and integration
tests pass fakes; `createHandlers(deps)` in `src/handlers.ts` holds the real ones (`send` and
`scheduledSend` since D2-04, the ingest handlers still stubs) and `createStubHandlers()` the
logging stubs used when the worker has no database.

| Queue | Concurrency | Rate limit |
| --- | --- | --- |
| `send` | `SEND_CONCURRENCY` (5) | `SEND_RATE_PER_SECOND` (50) jobs started per second per process |
| `dlr`, `click-ingest`, `postback-ingest` | `INGEST_CONCURRENCY` (5) | none |
| `scheduled-send` | 1 | none |

The send limiter caps how many lap jobs start per second; the per-route carrier throughput is a
separate concern handled inside the send handler (D2-04).

## Health

`GET /health` returns `{ ok, version, redis, database, queues }` with HTTP 200 when Redis and the
database answer, 503 otherwise. `queues` maps every queue and dead-letter queue to
`{ waiting, active, failed, delayed }` (`queueDepths()` in `src/health.ts`). It is `null` when
the counts cannot be read and absent when the process runs without Redis; it never flips `ok`.

## Shutdown

On `SIGINT`/`SIGTERM` the worker stops accepting HTTP, closes the workers (in-flight jobs finish,
no new ones start), closes the producer queues, then quits Redis. `SHUTDOWN_TIMEOUT_MS`
(30000) bounds the whole sequence; past it the process exits 1 and BullMQ's stalled-job
detection returns any unfinished job to its queue.

## Logging

`log(level, msg, fields)` in `src/log.ts` writes one JSON object per line to stdout:
`{"level":"info","msg":"worker listening","time":"...","port":4000}`. `LOG_LEVEL` (default
`info`) drops lower levels. `Error` values in fields are serialised to `{ name, message, stack }`.

Phone numbers must never be logged. If a number has to appear, pass it through
`maskPhone()`: `+34612345678` becomes `+34*******78` (country code and last two digits kept).
Job payloads are never logged in full for the same reason; handlers log ids and counts.

## Environment variables

| Variable | Default | Used for |
| --- | --- | --- |
| `REDIS_URL` | none (queues disabled) | BullMQ connection, created with `maxRetriesPerRequest: null` |
| `SEND_CONCURRENCY` | 5 | parallel `send` jobs per process |
| `SEND_RATE_PER_SECOND` | 50 | `send` jobs started per second per process |
| `INGEST_CONCURRENCY` | 5 | parallel jobs on the three ingest queues |
| `LAP_POLL_MS` | 5000 | lap dispatcher tick interval |
| `PAUSE_RETRY_MS` | 10000 | how long a paused lap's job is parked |
| `LINKS_BASE_URL` | `http://localhost:8787` | base of the `{{domain}}` short links |
| `INTERNAL_API_SECRET` | none (`/internal/*` answers 503) | shared secret for the internal API |
| `DATABASE_URL` | none (send handlers are stubs) | Postgres for the send loop and `/health` |
| `LOG_LEVEL` | `info` | minimum log level |
| `SHUTDOWN_TIMEOUT_MS` | 30000 | hard limit on graceful shutdown |
| `WORKER_PORT` | 4000 | HTTP port |

Concurrency, rate and interval values must be positive integers; the worker refuses to start
otherwise.

## Tests

- Unit: `pnpm --filter @sendex/worker test` (schemas, settings, dead-letter rules, health, logging).
- Integration: `apps/worker/src/queues.integration.test.ts` and
  `apps/worker/src/send/send.integration.test.ts` run only when `REDIS_URL` is set and
  reachable (`describe.skipIf`), under a unique key prefix they obliterate afterwards:
  `REDIS_URL=redis://127.0.0.1:6379 pnpm test` (works through turbo too: `REDIS_URL` is declared
  on the `test` task in `turbo.json`, so it reaches the package and is part of the cache key).

## Providers

`createProviderRegistry()` in `packages/providers/src/registry.ts` maps a provider name to a
`Provider`. The worker registers every adapter at boot and resolves one per route with
`resolveProviderForRoute(registry, route)`, where `route.provider` is the name stored on the
route row. An unknown name throws `Unknown provider "x". Registered providers: ...`.
