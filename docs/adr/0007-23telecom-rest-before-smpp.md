# ADR 0007: 23Telecom through its REST API first, SMPP when the account is whitelisted

Date: 2026-11-06. Status: accepted.

## Context

The tech stack and ADR 0002 planned 23Telecom as an SMPP carrier: a persistent `bind_transceiver` session from the worker with a static egress IP whitelisted on their side. `SmppProvider` is built and tested against the in-process simulator. On the day the account arrived it came with a REST API key in sandbox mode (`sk_test_…`) and no SMPP credentials yet; SMPP needs their support to whitelist the worker's egress IP (`209.71.97.132`) and issue a system id, which takes days, while the REST API answers immediately and its sandbox synthesizes delivery reports for free.

23Telecom's REST API (docs.23telecom.co.uk) sends personalised bulk batches (`POST /sms/send-individual`, up to 1000 messages per request, idempotency keys), returns one carrier id per recipient, and delivers reports to a signed webhook. That is the same contract `Provider` asks for: `send`, `parseDeliveryReceipt`, `priceFor`, `validateSenderId`.

## Decision

- **Add `Telecom23Provider`** (`packages/providers/src/http/telecom23-provider.ts`) as a second adapter for the same carrier, registered in the worker as provider key `23telecom` whenever `TELECOM23_API_KEY` is set. `SmppProvider` stays, registered as `smpp` when `SMPP_HOST` is set. A route row picks one or the other through its `provider` column, so switching a route from REST to SMPP is a data change, not a deploy.
- **Delivery reports come in on a public worker route**, `POST /webhooks/23telecom/delivery`, which verifies the portal's HMAC signature (`TELECOM23_WEBHOOK_SECRET`), drops intermediate states and puts final ones on the existing `dlr` queue under the `23telecom` provider name. The handler that applies receipts is unchanged.
- **Idempotency on their side**: every request carries an `Idempotency-Key` derived from the sorted message ids, so a retry after a timeout replays the carrier's stored answer. On our side the ledger debit is still written per batch before the submit (rule 6), and refunds follow failed outcomes as for any provider.
- **Prices stay in `route_prices`.** The REST API's pricing endpoint needs a live key and lists rates per network, not per country; the route's price rows remain the source of truth for the estimate and the ledger.
- **Sandbox first.** The seeded 23Telecom route points at `23telecom`; with the sandbox key a campaign runs end to end (accepted `test_` ids, synthesized `DELIVRD` receipts) without a message leaving 23Telecom or a cent spent. Going live is one secret change.

## Consequences

- The first real messages can go out as soon as a live key exists, without waiting on SMPP whitelisting. Throughput is bounded by their HTTP rate limit (per-key burst, 429 with `Retry-After`) instead of an SMPP window; the send loop already treats 429 outcomes as retryable.
- The worker now has a second public, carrier-facing route next to postbacks and the public API; it needs the same WAF rules (ADR 0004) and the signing secret must be set before a live key is used.
- Two adapters for one carrier means two sets of error codes in the message log (`HTTP_429_RATE_LIMITED` versus `ESME_RTHROTTLED`). The results page shows them as the provider reports them; mapping them to one vocabulary is deferred until a second carrier makes it worthwhile.
- SMPP keeps its advantages for volume (one session, binary PDUs, receipts on the same connection) and remains the target for high-volume routes once the whitelist is confirmed (D2-00).
