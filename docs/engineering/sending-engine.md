# Sending engine

How a campaign send becomes SMS: the lap dispatcher, the send loop, who is excluded and why,
how money moves, what pause and stop do, and the internal API the web app uses to follow
progress and queue extra laps. Code lives in `apps/worker/src/send/` and
`packages/db/src/queries/sending.ts`.

Cards: D2-04 (send loop), D2-05 (contact reuse and opt-out), D2-06 (progress), D2-07
(Finish List and budget sends), D3-01 (delivery receipts and expiry). See also
`services-and-queues.md` for the queue plumbing.

## The contract with the web app

The campaign page never talks to Redis. To send, it inserts `laps` rows in status `queued`
(one per list x route, `test_size` = how many numbers to send) and writes an `audit_log`
row. The worker does the rest. To send more later ("Finish List", "EUR 10 more") it calls
`POST /internal/laps` (below), which inserts the same kind of row.

## Lifecycle of a lap

```
queued ──dispatcher──▶ sending ──send loop──▶ done
                          │
                          └──stop / precondition failed──▶ cancelled
```

1. **Dispatcher** (`send/dispatcher.ts`). A repeatable BullMQ job on `scheduled-send`
   (every `LAP_POLL_MS`, default 5 s; registered at boot with `upsertJobScheduler`) runs
   `claimQueuedLaps(now)`: one `UPDATE laps SET status = 'sending' WHERE status = 'queued'
   AND campaign is not paused/stopped AND (scheduled_at IS NULL OR scheduled_at <= now)
   RETURNING`. Every claimed lap gets a `SendLapJob` on the `send` queue with BullMQ job id
   `lap-<lapId>` (BullMQ forbids `:` in custom ids; the payload's `idempotencyKey` is
   `lap:<lapId>`). BullMQ ignores an `add` whose job id already exists, so a lap is never
   enqueued twice. If the add fails the lap goes back to `queued` for the next tick.
   Scheduled campaigns need no job of their own: their laps wait in `queued` until
   `scheduled_at` has passed.

2. **Send loop** (`send/send-lap.ts`, `sendLap()`), one job per lap:
   - Load the lap context: lap, campaign, list, route, the campaign's active sender ids
     (sorted by value), active texts (by position), first active link, and the route's
     current price for the list's country (`route_prices` with the latest `valid_from <= now()`).
   - Checks that cannot be fixed by retrying cancel the lap with a reason in the audit log
     (`lap.cancel`): campaign stopped, emergency stop flag, route inactive, unknown provider,
     no price, no active text, no active sender id, insufficient balance. A paused campaign
     parks the job instead (see below). A lap already `done` or `cancelled` is a no-op.
   - **Balance check.** Before the first message, the estimated cost
     `remaining x max parts x price` must not exceed `getBalanceMicro()`; otherwise the lap is
     cancelled with `insufficient balance` and the balance and estimate in the audit details.
   - **Resume.** Messages still `queued` from an earlier attempt (the worker crashed after
     inserting them) are submitted first, then the loop creates `test_size - existing`
     new ones. Replaying the job never creates a second message for a contact.
   - **Batches of 50.** Each batch is one transaction (`claimAndCreateMessages`): select
     eligible members `FOR UPDATE SKIP LOCKED` (so two laps of the same campaign on the same
     list never pick the same contact), render each message, insert the `messages` row in
     status `queued` with `idempotency_key = <lapId>:<contactId>` (`ON CONFLICT DO NOTHING`)
     and its ledger debit. Then `provider.send(batch)`; then `applyOutcomes` in a second
     transaction.
   - Between batches the loop re-reads `campaigns.status` and the emergency stop key.
   - At the end: lap `done` with `finished_at`, `lists.last_sent_at`, an audit row
     `lap.finish` with `{ sent, failed, planned, skipped }`, and `laps.rank` recomputed for the
     campaign's `done` laps with `rankLaps()` (CTR, then cost per click, then sent).

### Lifecycle of a message

| Step | `messages.status` | Ledger |
| --- | --- | --- |
| Created in the batch transaction | `queued` | `debit` of `parts x price_micro`, key `msg:<messageId>` |
| Provider accepted | `sent` (+ `provider_message_id`, `sent_at`); `list_members.sent_at` set | none |
| Provider failed | `failed` (+ `error_code`) | `refund`, key `refund:<messageId>` |
| Lap stopped while queued | `cancelled` | `refund`, key `refund:<messageId>` |
| Delivery receipt `DELIVRD` (D3-01) | `delivered` (+ `delivered_at`) | none |
| Delivery receipt `UNDELIV` / `REJECTD` / ... | `failed` (+ `error_code` from the carrier) | none |
| Delivery receipt `EXPIRED` | `expired` (+ `error_code`) | none |
| No receipt 24 h after `sent_at` | `expired` (`error_code NO_RECEIPT`) | none |

Refunds are derived from the debit rows (`INSERT ... SELECT -amount_micro ... ON CONFLICT DO
NOTHING`), so a refund always matches what was charged and can never be written twice.
`laps.sent`, `laps.failed` and `laps.cost_micro` are incremented in the same transaction as
the outcomes; `cost_micro` counts accepted messages only. A message the carrier accepted is
not refunded when a receipt later says it was not delivered: the carrier charged for the
attempt.

### Delivery receipts (D3-01)

Receipts arrive on the provider's bound session, not per job. At boot `index.ts` calls
`subscribeDeliveryReceipts()` (`src/dlr/subscribe.ts`), which attaches a listener to every
`SmppProvider` in the registry (`onDeliveryReceipt`) and enqueues each receipt as a `DlrJob`
`{ provider, raw }` on the `dlr` queue. `provider` is the registry name, i.e. the
`routes.provider` value, and `raw` is the JSON-safe slice of the `deliver_sm` the provider
can parse again (`short_message` text, `receipted_message_id`, `message_state`); addresses are
left out so no phone number goes through Redis. `connectSmppProviders()` binds the session at
boot so receipts for messages sent before a restart flow at once. A receipt that cannot be
enqueued is logged and lost (the session already acknowledged it); the expiry sweep covers it.

The `dlr` handler (`src/dlr/handler.ts`, `createDlrHandler`) resolves the provider, calls
`parseDeliveryReceipt(raw)` and applies the result with `applyDeliveryReceipt()`
(`packages/db/src/queries/receipts.ts`): the message with that `provider_message_id` on a route
of that provider is updated and its lap counter bumped in one transaction.

| Message status | Receipt | Result |
| --- | --- | --- |
| `sent` | `delivered` | `delivered`, `delivered_at = receipt.at`, `laps.delivered + 1` |
| `sent` | `failed` / `expired` | that status, `error_code = receipt.errorCode`, `laps.failed + 1` |
| `delivered`, `failed`, `expired`, `cancelled` | any | ignored: final statuses never change, so a second receipt for the same message, a `failed` after a `delivered`, or a `delivered` arriving after the 24 h expiry all count nothing |
| no match | any | the job throws and is retried (2 s, 4 s); on its last attempt it logs `receipt matched no message, dropped` and completes |

The retry covers the normal race: the SMSC answers a `submit_sm` within milliseconds and the
batch outcome (which stores `provider_message_id`) is written after the whole batch of 50 has
been submitted, so the first receipts of a batch can arrive before their message is `sent`.
Receipts for the second and later parts of a multi-part message carry ids we do not store
(`SmppProvider` keeps the first part's id as `providerMessageId`) and are dropped the same way;
the first part's receipt decides the status. An unknown provider name or a receipt the provider
cannot parse fails with `UnrecoverableError` and goes to `dlr-dead` for inspection. The handler
logs ids and statuses only.

`laps.sent` counts what the carrier accepted and is never changed by a receipt. `laps.failed`
counts every message that will not be delivered: rejected at submit, carrier `UNDELIV` and the
like, carrier `EXPIRED`, and expired here. Delivery rate is `delivered / sent`;
`sent - delivered - failed` is still pending.

### Expiry

A `sent` message with no receipt after `DLR_EXPIRY_MS` (24 h) becomes `expired` with
`error_code NO_RECEIPT` and counts as failed on its lap. `createExpiryTick()`
(`src/send/expiry.ts`) runs `expireStaleMessages(db, now - window, { limit: 10000 })` from the
`scheduled-send` handler, at most once per `DLR_EXPIRY_POLL_MS` (60 s) per process; a failure
of the sweep is logged and never fails the dispatcher tick. The sweep runs across
organisations: it is worker maintenance, not a tenant action. The partial index
`messages_sent_pending_receipt_idx` (`sent_at WHERE status = 'sent'`) keeps it cheap.

### Rendering

Sender ids and texts rotate round-robin per message (a resumed lap continues the rotation
from the number of messages already created). Placeholders in the text:

| Placeholder | Value |
| --- | --- |
| `{{first_name}}` | `contacts.first_name`, empty when unknown |
| `{{phone}}` | the E.164 number |
| `{{domain}}` | `${LINKS_BASE_URL}/<shortCode>`; empty when the campaign has no active link |

The short code is 8 characters from an unambiguous alphabet (`SHORT_CODE_ALPHABET` in
`packages/core`), generated per message and stored in `messages.short_code`. The message also
records the ad text it was rendered from (`ad_text_id`) and the link it carries (`link_id`),
which the per-text and per-link click and conversion breakdowns group by.
`messages.dynamic_id` is a fresh UUID; the links service substitutes it for `{{dynamic}}` in
the link URL at redirect time. Encoding and parts come from `analyseSmsText` on the rendered
text, so the price reflects the real length.

## Who is excluded (D2-05)

One query, `eligibilityRules()` in `packages/db/src/queries/sending.ts`, used both to pick
members and to count what was skipped. A member of the lap's list is eligible when all of
these hold:

| Rule | SQL shape | Skip reason |
| --- | --- | --- |
| Not flagged bad | `list_members.bad = false` | `bad` |
| Never sent, or flushed after the last send | `sent_at IS NULL OR flushed_at > sent_at` | `alreadySent` |
| Number not suppressed for the organisation | `NOT EXISTS suppressions (organisation_id, e164)` | `suppressed` |
| No live message in this campaign | `NOT EXISTS messages (campaign_id, contact_id, status <> 'cancelled')` | `reused` |
| `contact_reuse = account_wide` only: not messaged anywhere in the organisation since the member's last flush | `NOT EXISTS messages (organisation_id, contact_id, status IN (sent, delivered), coalesce(sent_at, created_at) > flushed_at)` | `reused` |

`per_campaign` reuse applies only the fourth rule. The "live message in this campaign" rule
also makes resumes and parallel laps safe: a contact that already has a message in the
campaign (queued, sent, failed, ...) is not picked again by any lap of that campaign.
Members are taken in `list_members.id` order, `test_size` at most; when the list runs out
the lap finishes early and its progress total is lowered to what was actually processed.
The skip counts are taken before the lap sends and stored on the `lap.finish` audit row.

## Pause and stop

| Signal | Checked | Effect |
| --- | --- | --- |
| `campaigns.status = 'paused'` | before the lap starts and between batches | The lap stays `sending`; the job is parked with `moveToDelayed` (`PAUSE_RETRY_MS`, default 10 s) and looks again, without using an attempt. The dispatcher claims no new lap of the campaign. |
| `campaigns.status = 'stopped'` | same | Remaining `queued` messages become `cancelled` and are refunded; the lap becomes `cancelled` with `campaign stopped` in the audit log. Messages already submitted stay as they are. |
| Redis key `sendex:stop:<organisationId>` (any value; set by D2-10) | same | Same as stopped, reason `emergency stop`. Applies to every campaign of the organisation. |

The provider is never asked to recall a message; "stop" means no further batch is submitted.

## Progress (D2-06)

Per batch the loop updates Redis counters (7 day TTL):

```
sendex:lap:<lapId>:sent        sendex:campaign:<campaignId>:sent
sendex:lap:<lapId>:failed      sendex:campaign:<campaignId>:failed
sendex:lap:<lapId>:total       sendex:campaign:<campaignId>:total
```

`total` is the lap's `test_size`, lowered when the list runs out; the campaign total moves by
the same delta. `GET /internal/progress/campaigns/:id?organisationId=<org>` reads the
campaign's laps from the database and the counters from Redis (falling back to the lap row
when a key has expired), and returns

```json
{
  "campaignId": "…",
  "sent": 135, "failed": 7, "total": 300,
  "laps": [
    { "lapId": "…", "status": "done",    "sent": 90, "failed": 10, "total": 100 },
    { "lapId": "…", "status": "sending", "sent": 45, "failed": 0,  "total": 100 },
    { "lapId": "…", "status": "queued",  "sent": 0,  "failed": 0,  "total": 100 }
  ]
}
```

Campaign numbers are the sum of the laps, so a lap that never ran still counts its planned
total. The organisation id is required so a campaign is only visible to its tenant.

## Internal API

Routes under `/internal/*` on the worker's HTTP port, for server-side calls from the web app
only. Every request must carry `x-internal-secret: <INTERNAL_API_SECRET>`; a wrong or missing
header is 401, and when the variable is not set the routes answer 503. Request bodies are
validated with the Zod schemas in `packages/core/src/internal-api.ts`
(`createLapRequestSchema`), which the web app should reuse.

### `POST /internal/laps` (D2-07)

```json
{ "organisationId": "…", "campaignId": "…", "listId": "…", "routeId": "…",
  "mode": "finish" }
{ "organisationId": "…", "campaignId": "…", "listId": "…", "routeId": "…",
  "mode": "budget", "budgetMicro": 10000000 }
```

- `finish`: `finishListPlan` over the members currently eligible for the campaign on that
  list (same rules as above), i.e. send everything that is left.
- `budget`: `budgetPlan(budgetMicro, priceMicro)` at the route's current price for the
  list's country, capped by the eligible count.

Answers `201` with `{ lap, available, priceMicro, estimatedCostMicro }` (bigints as strings)
after inserting a `queued` lap and an audit row `lap.create`; the dispatcher picks it up on
its next tick and the send loop applies the balance check then. Errors: `400` invalid body,
`404` campaign/list/route not found for the organisation (platform routes with
`organisation_id` null are visible to everyone), `422` route inactive, no price, or nothing
to send.

## Providers

`routes.provider` names the adapter: `platform` and `fake` both resolve to `FakeProvider`
until the real adapters land; `smpp` (23Telecom, D2-15) is unknown until then, so a lap on
such a route is cancelled with `unknown provider "smpp"` rather than retried forever.
`createDefaultProviderRegistry()` in `send/providers.ts` is where adapters are registered.

## Environment variables

| Variable | Default | Used for |
| --- | --- | --- |
| `LAP_POLL_MS` | 5000 | dispatcher tick interval |
| `PAUSE_RETRY_MS` | 10000 | how long a paused lap's job is parked before it looks again |
| `LINKS_BASE_URL` | `http://localhost:8787` | base of the `{{domain}}` short links |
| `INTERNAL_API_SECRET` | none (routes answer 503) | shared secret for `/internal/*` |
| `DATABASE_URL` | none | without it the send and dispatch handlers are stubs that only log |
| `DLR_EXPIRY_MS` | 86400000 (24 h) | a `sent` message with no receipt after this long is expired |
| `DLR_EXPIRY_POLL_MS` | 60000 | minimum time between two expiry sweeps per process |

## Tests

- `packages/db/src/queries/sending.test.ts` (PGlite): every exclusion rule and skip count,
  the lap context, claim/create idempotency, outcomes with refunds applied twice, cancel,
  dispatcher claim, finish/rank, the lap API helpers.
- `apps/worker/src/send/send-lap.test.ts`: the loop against an in-memory store
  (`store.fake.ts`) and `FakeProvider`: batches, rotation, rendering, multi-part pricing,
  list exhaustion, balance refusal, pause, stop, emergency stop, resume, no-op on a finished lap.
- `apps/worker/src/send/send.integration.test.ts` (PGlite + Redis, skipped without
  `REDIS_URL`): seeds an organisation, 120 contacts, a campaign with two sender ids, two texts
  and a link, a fake route at 0.025 and a queued lap of 100; runs the dispatcher and the real
  send worker with `failEvery: 10`; asserts 90 sent / 10 failed, 100 debits and 10 refunds,
  the balance down by 90 x 0.025, 90 members marked, the lap done and ranked, a second
  dispatcher run enqueuing nothing and a re-run of the job creating nothing.
- `apps/worker/src/internal-api.test.ts`, `dispatcher.test.ts`, `progress.test.ts`.
- `packages/db/src/queries/receipts.test.ts` (PGlite): every status rule above, provider and
  organisation scoping, expiry with its limit, a late receipt after expiry.
- `apps/worker/src/dlr/handler.test.ts`, `subscribe.test.ts`, `send/expiry.test.ts`: the
  handler's log fields and retry-then-drop, the receipt payload round trip through JSON
  (no phone number), the throttled sweep.
- `apps/worker/src/dlr/delivery.integration.test.ts` (PGlite + the SMPP simulator, no Redis):
  a lap of 100 through `SmppProvider` with five numbers ending in 98 (the simulator reports
  `UNDELIV` for them); the 100 receipts are replayed through the handler and the lap shows
  100 sent, 95 delivered, 5 failed; a second replay changes nothing. Then five clicks (one
  recipient three times) give `laps.clicks = 5` and a 5.00 % CTR.
