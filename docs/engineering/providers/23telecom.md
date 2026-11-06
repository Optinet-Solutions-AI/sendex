# 23Telecom

Account runbook for the first carrier. 23Telecom offers two ways in: a REST API (what we use first, provider key `23telecom`) and SMPP (provider key `smpp`, section below, pending account details and IP whitelisting).

Status: **REST API live with a production key** (2026-11-06 evening; sandbox QA passed the same day). SMPP: template, account details pending.

## REST API (provider `23telecom`)

| Item | Value |
| --- | --- |
| Docs | https://docs.23telecom.co.uk (OpenAPI at `/openapi.yaml`, LLM text at `/llms-full.txt`) |
| Base URL | `https://restlink23telecom.com/api/v1` (`TELECOM23_BASE_URL` to override) |
| Auth | `X-API-Key` header. Keys are created in the portal under Settings, API Keys; `sk_test_…` is a sandbox key, `sk_prod_…` a live one (`TELECOM23_API_KEY`) |
| Key permissions | `sms.send` is required for sending; `sms.read` for status lookups. Enable them on the key in the portal |
| Send | `POST /sms/send-individual`, one text and sender per recipient, up to 1000 per request (we send 100), `Idempotency-Key` required (we derive it from the message ids, so a retry after a timeout replays the stored answer instead of sending twice) |
| Per-recipient results | `accepted` (carries `message_id`), `blocked_country`, `message_too_long`, `unpriced`, `config_error` (final), `queue_error`, `db_error` (retried) |
| Whole-request errors | 400/401/403 are final (`HTTP_<status>_<error_code>`); 408, 429 and 5xx are retried |
| Sender ID | 3 to 11 ASCII letters or digits, first character a letter (`^[A-Za-z][A-Za-z0-9]{2,10}$`) |
| Delivery reports | Webhook `POST https://sendex-worker.fly.dev/webhooks/23telecom/delivery`, JSON body `{message_id, recipient, sender_id, status, status_code, num_parts, cost, timestamp}`. Set the URL in the portal under Webhooks (it is per workspace and cannot be set with a sandbox key) |
| Webhook signing | Portal, Webhooks, Security: set a signing secret and put the same value in `TELECOM23_WEBHOOK_SECRET`. Requests then carry `X-Webhook-Timestamp` and `X-Webhook-Signature: sha256=<hex>` over `"{timestamp}.{raw body}"`; the worker rejects anything older than 5 minutes or unsigned |
| Statuses | `DELIVRD` delivered; `EXPIRED` expired; `UNDELIV`, `REJECTD`, `UNKNOWN`, `DELETED`, `failed`, `credit_rejected` failed (the carrier `status_code` is kept as the error code); `SENT`, `ENROUTE`, `ACCEPTD`, `pending` are acknowledged and ignored |
| Retries from their side | 3 attempts (10 s, 30 s backoff) on timeout, 408, 429 or 5xx; the worker answers 503 when Redis refuses the job so the carrier retries |
| Sandbox | Simulated sends with ids `test_…`, a `DELIVRD` webhook about 5 s after each send (`"sandbox": true` in the body), balance untouched, messages kept 24 h. Sandbox keys can call only the send, status and messages endpoints; pricing, balance and webhook settings need a live key |
| Prices | Not fetched from the API; `route_prices` rows on the 23Telecom route (per country) price the sends, as for every provider |
| Lost receipts | The worker polls `GET /sms/status/{id}` for `sent` messages whose webhook has not arrived after `RECEIPT_POLL_AFTER_MS` (default 10 min), at most every `RECEIPT_POLL_EVERY_MS` (60 s), 200 ids per poll (D2-23). The sandbox sends each receipt once from a bounded pool, so a burst of 200 loses most of them; live receipts are not guaranteed either |

Code: `packages/providers/src/http/telecom23-provider.ts` (adapter), `apps/worker/src/webhooks/telecom23.ts` (webhook), `apps/worker/src/send/providers.ts` (registration). Decision record: ADR 0007.

### Going live on the REST API

1. Create an `sk_prod_…` key in the portal with `sms.send` and `sms.read`, set it as `TELECOM23_API_KEY` on Fly (`fly secrets set -a sendex-worker TELECOM23_API_KEY=...`).
2. Keep the webhook URL and signing secret as they are; they are workspace settings, not key settings.
3. Fill `route_prices` for every country the account is sold for (the portal's Pricing page or `GET /user/pricing` with the live key lists rates per network).
4. Send D2-18's first real message to a test phone and watch `fly logs` for `receipt applied`.

## SMPP (provider `smpp`)

Fill every `TODO` from the 23Telecom onboarding e-mail / portal before going live; until then the worker runs against the simulator (see [smpp.md](./smpp.md)).

## Connection

| Item | Value |
| --- | --- |
| Protocol | SMPP 3.4, `bind_transceiver` |
| Host | TODO (`SMPP_HOST`) |
| Port | TODO (`SMPP_PORT`; plain 2775 or TLS 3550, confirm which) |
| TLS | TODO (`SMPP_TLS=true` if they terminate TLS) |
| `system_id` | TODO (`SMPP_SYSTEM_ID`) |
| `password` | TODO (`SMPP_PASSWORD`, Fly.io secret only) |
| `system_type` | TODO (often empty; some accounts require a fixed string) |
| Allowed binds per account | TODO (number of simultaneous sessions; we open one per worker instance) |
| IP whitelist | Worker outbound IP `209.71.97.132` (Fly egress IP, region syd, allocated 2026-11-06). TODO: note the date 23Telecom confirms it |
| Window size | TODO (their maximum outstanding `submit_sm`; set `SMPP_WINDOW`, default 10) |
| Throughput | TODO (messages per second per bind; set `SMPP_TPS` slightly below it) |
| Keepalive | `enquire_link` every 30 s (confirm their idle timeout is longer) |

## Routes and prices

One row per route in the provider registry / routes table. Prices in EUR per SMS part.

| Route code | Country | Price per part | Notes |
| --- | --- | --- | --- |
| TODO `23t-premium` | ES | TODO | TODO: direct or hubbed route |
| TODO | FR | TODO | |
| TODO | GB | TODO | |
| TODO | DE | TODO | |

Allowed countries: TODO (list from the contract; everything else must be rejected before sending).

## Sender ID rules

Default rule in `SmppProvider`: 3 to 11 alphanumeric characters. Override with `senderIdRules` once the carrier rules are known.

| Country | Alphanumeric sender | Numeric sender | Pre-registration | Notes |
| --- | --- | --- | --- | --- |
| ES | TODO | TODO | TODO | |
| FR | TODO | TODO | TODO | TODO: France usually requires alphanumeric and a STOP mention |
| GB | TODO | TODO | TODO | |
| DE | TODO | TODO | TODO | TODO: German networks often replace sender ids |

Address formats they expect: alphanumeric sender `TON 5 / NPI 0`, numeric sender `TON 1 / NPI 1`, destination `TON 1 / NPI 1` without `+` (change in `encoding.ts` only if 23Telecom says otherwise). TODO: confirm.

## Encoding and concatenation

- GSM 03.38 as `data_coding 0`, UCS-2 as `data_coding 8`. TODO: confirm they do not require `data_coding 1` (IA5) or Latin-1 (`3`) for the default alphabet.
- Multipart via UDH (`esm_class 0x40`, 8-bit reference). TODO: confirm UDH is accepted (some carriers want `sar_*` TLVs or `message_payload` instead).
- Maximum parts per message: TODO.

## Delivery receipts (DLR)

Requested with `registered_delivery 1`. Expected `deliver_sm` text in the SMPP 3.4 appendix B format:

```
id:<message_id> sub:001 dlvrd:001 submit date:YYMMDDhhmm done date:YYMMDDhhmm stat:DELIVRD err:000 text:...
```

| Item | Value |
| --- | --- |
| `receipted_message_id` TLV present | TODO |
| `message_state` TLV present | TODO |
| One receipt per part or per message | TODO |
| Timestamps in UTC or carrier local time | TODO (parser assumes UTC) |
| `id` format matches `submit_sm_resp.message_id` (hex vs decimal) | TODO: some SMSCs return decimal in the receipt and hex in the response |
| Intermediate states (`ACCEPTD`, `ENROUTE`) sent | TODO (parser maps them to `failed`; filter them before updating a message if they are sent) |

### `err:` codes

| err | Meaning | Action |
| --- | --- | --- |
| `000` | delivered | none |
| TODO | absent subscriber | retry later |
| TODO | unknown subscriber | drop from list |
| TODO | blocked / blacklisted | drop from list |

## SMPP error codes specific to this account

Standard codes are in [smpp.md](./smpp.md). 23Telecom-specific or vendor-specific statuses (`0x400`+):

| command_status | Meaning | Retryable |
| --- | --- | --- |
| TODO | | |

## Operations

- Support contact / NOC: TODO (e-mail, phone, hours).
- Balance / prepaid top-up: TODO (where to check; alert threshold).
- Maintenance windows: TODO.
- Test numbers: TODO (numbers that always deliver / always fail, for the smoke test after a deploy).

## Go-live checklist

- [ ] IP whitelisted and bind confirmed from production (`provider.session.binds >= 1`).
- [ ] One GSM, one UCS-2 and one 2-part message delivered to a real handset per country.
- [ ] Receipt parsed to `delivered` with the right `providerMessageId`.
- [ ] `SMPP_TPS` and `SMPP_WINDOW` set from the contract.
- [ ] Route prices entered and `priceFor` returning them.
- [ ] Sender id rules encoded in `senderIdRules`.
