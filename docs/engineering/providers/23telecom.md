# 23Telecom (SMPP)

Account runbook for the first carrier. Fill every `TODO` from the 23Telecom onboarding e-mail / portal before going live; until then the worker runs against the simulator (see [smpp.md](./smpp.md)).

Status: **template, account details pending**.

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
