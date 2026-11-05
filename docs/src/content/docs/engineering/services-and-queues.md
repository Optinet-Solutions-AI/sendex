---
title: Services and queues
description: The BullMQ queues the worker consumes, who produces to them, and what each job carries.
---

All asynchronous work goes through BullMQ on Redis (Upstash in production, a local Redis in development). Queue payloads are validated with Zod schemas from `packages/core` on both the producing and consuming side, and every job carries the `organisation_id` it belongs to.

## Queues

| Queue             | Producer                                  | Consumer | Job                                                                                                                                 |
| ----------------- | ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `send`            | web (start batch, Finish List)            | worker   | One job per lap of messages for a route. The worker builds the short links, debits the ledger and submits to the provider.          |
| `dlr`             | worker (SMPP `deliver_sm`, HTTP webhooks) | worker   | A raw delivery receipt. Parsed with the provider's `parseDeliveryReceipt`, then the message is marked delivered, failed or expired. |
| `click-ingest`    | links (Cloudflare)                        | worker   | A click event: short code, click id, timestamp, user agent, IP country. Deduplicated per recipient.                                 |
| `postback-ingest` | worker (public postback endpoint)         | worker   | A registration or sale postback carrying the click id and optional value. Attributed to message, route and campaign.                |
| `scheduled-send`  | web (schedule)                            | worker   | A delayed job that fires at the scheduled instant in the campaign country's timezone and enqueues the corresponding `send` jobs.    |

## Rules

- **Idempotency.** `send` jobs are keyed by message id; a retried job finds its ledger debit and skips the second charge.
- **Retries.** Provider submissions that fail with `retryable: true` are retried with backoff; non-retryable failures mark the message failed immediately.
- **Pause and stop.** Pause drains the queue for the campaign without removing jobs; stop and emergency stop remove the campaign's (or organisation's) pending jobs and release reserved balance.
- **Dead letters.** Jobs that exhaust their retries land in a per-queue failed set that the worker exposes on `/health` so a stuck queue is visible.

## Local development

`pnpm dev` starts the worker against `REDIS_URL` from `.env`. The BullMQ queues are created on first use; there is nothing to provision by hand. See [Local setup](/engineering/runbooks/local-setup/).
