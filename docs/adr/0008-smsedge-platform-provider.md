# ADR 0008: SMS Edge serves the platform routes through its API, with delivery by polling

Date: 2026-11-06. Status: accepted.

## Context

Sendex rents routes rather than owning them. The first-version plan reserved the `platform` provider key for "SMS Edge style" rented routes and served it with the FakeProvider until an adapter existed. On 2026-11-06 the SMS Edge API token arrived. Their API (developers.smsedge.io) differs from a carrier's in three ways that shape the adapter: authentication is an `api_key` query parameter rather than a header; there is no multi-recipient endpoint for our own recipient lists, only `send-single` per message and `send-list` for lists stored inside SMS Edge; and there is no delivery webhook for SMS, only `GET /v1/sms/get/?ids=` to read `dlr_status` for ids we already hold.

D2-23 had just added an optional `pollReceipts` capability to `Provider` with a worker sweep that asks a carrier about `sent` messages whose receipt has not arrived, because 23Telecom's receipts are not guaranteed either.

## Decision

- **Add `SmsEdgeProvider`** (`packages/providers/src/http/smsedge-provider.ts`) and register it under the existing `platform` key whenever `SMS_EDGE_API_KEY` is set; the FakeProvider keeps the key otherwise. No route row changes: the seeded platform routes (`136`, `137`, `375`, …) are already SMS Edge route names.
- **One `send-single` call per message**, up to four in parallel, with `reference` = our message id so a replayed batch cannot double-send, `shorten_url=0` so our tracked link is sent as written, and `preferred_route_id` resolved from the route name through `GET /v1/routes/getall/` once per process. Their `send-list` endpoint is not used: our lists live in our database, and uploading them to SMS Edge would hand a partner the recipient data we are meant to own.
- **Delivery by polling, not by webhook.** `SmsEdgeProvider.pollReceipts` implements the D2-23 capability with `GET /v1/sms/get/`, 100 ids per call. Delivery therefore lags by the poll grace period (10 minutes by default) rather than arriving in seconds. That is acceptable for a marketing platform whose results are read per lap, and it reuses the sweep rather than adding a second mechanism.
- **Prices stay in `route_prices`.** SMS Edge's route list carries their price per country; what we charge the organisation is our price. `listRoutes()` exposes their list for comparison; no automatic sync.
- **No sandbox, so no default enablement.** The key is not set on Fly by this change. Enabling it is a deliberate operational step (runbook `docs/engineering/providers/smsedge.md`) that switches every platform route in every organisation to real sends.

## Consequences

- The platform routes become real as soon as the secret is set, with the same send loop, ledger and results pages as the carrier routes. The first live SMS (D2-18) can go through SMS Edge before 23Telecom's live key exists.
- Throughput is one HTTP call per message. At four in parallel and roughly 200 ms per call that is about 20 messages per second per worker, below the SMPP target but well above what the demo and the first campaigns need. Raising it is a constructor option, bounded by their undocumented rate limit.
- Delivered counts on platform routes move in steps of one poll interval, not live. The campaign page already shows pending as `sent - delivered - failed`, so nothing in the UI changes.
- One account key sends for every organisation. Per-organisation keys, if SMS Edge ever offers them, would become a `routes.config` field; the registry would then need per-route provider instances, which ADR 0002 left open.
- The adapter is the first consumer of `pollReceipts` that is poll-only. If the poll sweep is ever disabled, platform messages never leave `sent` until the 24-hour expiry; the worker should log that combination at boot (not done in this change).
