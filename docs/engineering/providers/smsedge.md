# SMS Edge

Account runbook for the platform routes. SMS Edge is the aggregator Sendex is modelled on; its API serves our `platform` routes (route names `136`, `137`, `375`, … are SMS Edge route names) until our own carrier routes cover the same countries.

Status: **adapter built, not enabled in production** (2026-11-06). The worker serves `platform` routes through the FakeProvider until `SMS_EDGE_API_KEY` is set on Fly. There is no sandbox: the key means real messages and real spend.

## API (provider `platform`)

| Item | Value |
| --- | --- |
| Docs | https://developers.smsedge.io (ReadMe site; every page is also readable as `/reference/<slug>.md`) |
| Base URL | `https://api.smsedge.com` (`SMS_EDGE_BASE_URL` to override) |
| Auth | `api_key` query parameter on every call (`SMS_EDGE_API_KEY`). The key is the account's, not per workspace: anyone with it can send and read the balance |
| Answers | Every response is a one-element array around `{ success, data, errors, response, api, user }` |
| Send | `POST /v1/sms/send-single/` per message: `from`, `to` (digits, no `+`), `text`, `reference` = our message id (SMS Edge refuses a second submit with the same reference), `shorten_url=0` (our tracked link stays as is), `preferred_route_id` = the SMS Edge route id. Four calls in parallel per batch. There is no multi-recipient endpoint for our own lists; `send-list` only sends to lists stored in SMS Edge |
| Route ids | SMS Edge calls a route `Route 137` with id `108`; our route rows carry the name `137`. The adapter maps name to id from `GET /v1/routes/getall/` on first use. A route name that SMS Edge does not know fails the message with `UNKNOWN_ROUTE` (final) |
| Outcomes | `success: true` with `data.id` is accepted (the id is the carrier message id); `success: false` is a final failure with the first `errors[]` text as the reason (`INSUFFICIENT_BALANCE`); HTTP 408, 429 and 5xx and network errors are retried (`HTTP_429_…`, `NETWORK_…`) |
| Delivery reports | None for SMS (their webhooks are for WhatsApp and Telegram). Delivery is read by the receipt poll (D2-23): `GET /v1/sms/get/?ids=…`, 100 ids per call, for `sent` messages older than `RECEIPT_POLL_AFTER_MS` |
| Statuses | `dlr_status` `DELIVERED` delivered; `EXPIRED` expired; `UNDELIVERED`, `REJECTED`, `FAILED`, `DELETED` failed (kept as the error code); `status: failed` without a dlr status failed; `QUEUED`, `SENT`, empty pending |
| Sender ID | 1 to 11 letters or digits (`^[A-Za-z0-9]{1,11}$`); numeric senders allowed |
| Prices | `GET /v1/routes/getall/` lists every route with a price per country; `SmsEdgeProvider.listRoutes()` reads it. The worker still prices from `route_prices`: copy the prices you want to sell at into the platform routes' rows |
| Balance | `POST /v1/user/details/` returns the account balance; not read by the worker |

Code: `packages/providers/src/http/smsedge-provider.ts` (adapter), `apps/worker/src/send/providers.ts` (registration as `platform`), `apps/worker/src/dlr/poll.ts` (receipt poll). Decision record: ADR 0008.

## Enabling it in production

Do this only with a sign-off on who pays and which numbers may receive messages; every platform route in every organisation switches from the FakeProvider to real sends at once.

1. Make sure the `platform` route rows have `route_prices` for the countries that will be sent to; a lap on a route without a price cancels.
2. Make sure every organisation that can reach the platform routes holds real money in its ledger. The seeded `external` organisation carries demo credit: re-seed it to zero or restrict its routes first.
3. For the first sends, set `SEND_ALLOWLIST_E164` on the worker to the test numbers (comma separated E.164): every provider then refuses any other recipient before the carrier is called, so a seeded or mistaken list cannot go out. Remove it once real campaigns start.
4. `fly secrets set -a sendex-worker SMS_EDGE_API_KEY=…` (this restarts the worker).
5. Send D2-18's first real message: a campaign with one test number of ours on one platform route with test size 1. Check `fly logs` for `batch submitted` with `provider: platform`, then `receipts polled` with `applied: 1` within `RECEIPT_POLL_AFTER_MS` plus one minute.
6. To turn it off: `fly secrets unset -a sendex-worker SMS_EDGE_API_KEY`.

## Operational notes

- SMS Edge keeps our `reference` (the message id), so a batch replayed after a timeout cannot double-send: the second submit is refused and the send loop records the refusal.
- Rate limits are undocumented. If `HTTP_429_…` outcomes appear in the message log, lower `concurrency` in `smsEdgeProviderFromEnv` (default 4) or the worker's `sendRatePerSecond`.
- Route and price changes on their side are silent. `listRoutes()` is the source for a periodic comparison with `route_prices`; until that job exists, check the routes page in their dashboard after a price mail.
