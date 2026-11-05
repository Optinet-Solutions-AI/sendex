# Sending engine

How a campaign send becomes SMS: the lap dispatcher, the send loop, who is excluded and why,
how money moves, what pause and stop do, and the internal API the web app uses to follow
progress and queue extra laps. Code lives in `apps/worker/src/send/` and
`packages/db/src/queries/sending.ts`.

Cards: D2-04 (send loop), D2-05 (contact reuse and opt-out), D2-06 (progress), D2-07
(Finish List and budget sends). See also `services-and-queues.md` for the queue plumbing.

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
| Delivery receipt (D2-07 dlr, later) | `delivered` / `expired` | none |

Refunds are derived from the debit rows (`INSERT ... SELECT -amount_micro ... ON CONFLICT DO
NOTHING`), so a refund always matches what was charged and can never be written twice.
`laps.sent`, `laps.failed` and `laps.cost_micro` are incremented in the same transaction as
the outcomes; `cost_micro` counts accepted messages only.

### Rendering

Sender ids and texts rotate round-robin per message (a resumed lap continues the rotation
from the number of messages already created). Placeholders in the text:

| Placeholder | Value |
| --- | --- |
| `{{first_name}}` | `contacts.first_name`, empty when unknown |
| `{{phone}}` | the E.164 number |
| `{{domain}}` | `${LINKS_BASE_URL}/<shortCode>`; empty when the campaign has no active link |

The short code is 8 characters from an unambiguous alphabet (`SHORT_CODE_ALPHABET` in
`packages/core`), generated per message and stored in `messages.short_code`.
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

## Daily caps (D3-11)

Before every batch of new messages the guard also asks the organisation's daily caps
(`organisation_settings.daily_message_cap`, `daily_spend_cap_micro`; both null means the
check is skipped). `sendLap` gets a `CapsStore` (`packages/db/src/queries/caps.ts`) and a
clock; `capDecision` from `packages/core` turns today's usage (`dailyUsage`: messages created
since midnight UTC in any status but cancelled, net message debits since then) and the next
batch's estimated cost (`wanted x max parts x price`) into one of:

| Decision | What the loop does |
| --- | --- |
| `allow` | The batch is created as planned. |
| `trim` to `allowed` | `claimAndCreateMessages` is called with `limit = allowed`; the next guard call then refuses. |
| `refuse` | The remaining `remaining` messages are refused: `recordLapRefusal` adds them to `laps.refused` and sets `laps.refusal_reason` (`daily_message_cap` / `daily_spend_cap`); `raiseAlert` stores one alert per cap per UTC day (`alert.raise`); `pauseCampaign` moves a `sending` or `scheduled` campaign to `paused` with an audit row `campaign.pause` `{ reason, by: "worker", lapId, refused, cap }`. The lap then finishes normally (`done`, progress total lowered to what was created, `lap.finish` details carry `refused` and `refusalReason`) and the result is `{ outcome: "done", refused, reason: "daily message cap" }`. |

Paused rather than stopped so the owner can raise the cap under Settings → Billing and
resume; the refused numbers were never created or charged, so a later "Finish List" lap picks
them up. Messages left `queued` by an earlier attempt are resubmitted without a cap check:
they were created, and counted, earlier today. The check is per batch, so laps running in
parallel for one organisation can each overshoot by one batch at most. The 500-cap / 600-send
scenario is `send-lap.test.ts` ("sends up to the daily message cap, refuses the rest and
pauses the campaign"): 10 batches go, the 11th is refused, `refused: 100`.

The spike and low balance checks ride on the dispatcher tick (`apps/worker/src/alerts/checks.ts`,
`runAlertChecks` after `dispatchQueuedLaps`; a failure there never fails the dispatch):
organisations with a message in the last hour get `sendRate` → `spikeDecision` (an alert
`send_spike` per UTC hour), organisations with a low balance rule get
`shouldAlertLowBalance` (alert `low_balance`, `markLowBalanceAlerted`, rearm). Each organisation
is checked at most once per five minutes through a Redis `SET NX PX` key, shared by every
worker process.

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
