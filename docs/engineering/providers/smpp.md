# SMPP provider

`SmppProvider` (`packages/providers/src/smpp/`) is the `Provider` implementation for carriers reached over SMPP 3.4. 23Telecom was planned as the first SMPP account but is reached over its REST API instead (see [23telecom.md](./23telecom.md)); SMPP stays for carriers and custom routes that need it. Only the worker instantiates it; the web app never talks to a carrier (AGENTS.md rule 10).

Built on [node-smpp](https://github.com/farhadi/node-smpp) (`smpp` 0.6.0-rc.4). The package ships no types; `packages/providers/src/smpp-types.d.ts` declares the parts we use.

## Files

| File | Role |
| --- | --- |
| `smpp/session.ts` | `SmppSession`: connect, bind, keepalive, reconnect, submit window, throughput cap, `deliver_sm` events |
| `smpp/encoding.ts` | message to `submit_sm` fields: data coding, UDH concatenation, address TON/NPI |
| `smpp/receipt.ts` | delivery receipt parsing (`deliver_sm` text and TLVs) |
| `smpp/smpp-provider.ts` | `SmppProvider implements Provider`; error mapping, part ids, receipt listeners |
| `smpp/simulator.ts` | `startSimulator()`: in-process SMSC for tests and local development |
| `smpp/mask-phone.ts` | `maskPhone()` for logs: `+34600123456` becomes `+34*******56` |

## Lifecycle

```ts
const provider = new SmppProvider({
  name: "23telecom",
  host: env.SMPP_HOST,
  port: env.SMPP_PORT,
  systemId: env.SMPP_SYSTEM_ID,
  password: env.SMPP_PASSWORD,
  tls: env.SMPP_TLS === "true",
  windowSize: env.SMPP_WINDOW,          // default 10
  throughputPerSecond: env.SMPP_TPS,    // default unlimited
  prices: { "23t-premium:ES": 0.031 },  // `${route}:${country}` in EUR per part
});
await provider.connect();               // optional: otherwise the first send() binds
const unsubscribe = provider.onDeliveryReceipt((receipt) => { /* update message status */ });
const outcomes = await provider.send(batch);
await provider.close();                 // unbind, stop reconnecting
```

1. `connect()` opens `smpp://host:port` (`ssmpp://` when `tls` is set) and sends `bind_transceiver` with `system_id`, `password`, `system_type` (empty by default) and `interface_version 0x34`.
2. Once bound, queued `submit_sm` go out through the window and `deliver_sm` is acknowledged and emitted.
3. `send()` waits for the bind (up to `bindTimeoutMs`, 30 s) and **throws `SmppBindError`** only when the SMSC refuses the bind or none can be established in time. Everything else is reported per message in the outcomes; `send()` never throws for one bad message.
4. `close()` sends `unbind`, waits for the response (2 s cap), ends the socket and fails whatever is still pending with `SmppSessionClosedError`.

Phone numbers never reach the logger: the session logs the SMPP status and `maskPhone(destination)` only.

## PDU mapping (`encoding.ts`)

| Message | `submit_sm` field | Value |
| --- | --- | --- |
| alphanumeric sender (`BIGSPINS`) | `source_addr_ton` / `source_addr_npi` | `5` / `0` |
| numeric sender (`+34600000000`) | `source_addr_ton` / `source_addr_npi` | `1` / `1`, `+` stripped |
| destination E.164 | `dest_addr_ton` / `dest_addr_npi` / `destination_addr` | `1` / `1` / digits without `+` |
| GSM 03.38 text | `data_coding` | `0` (node-smpp encodes to GSM, one septet per byte) |
| UCS-2 text | `data_coding` | `8` (UTF-16BE) |
| any | `registered_delivery` | `1` (final receipt requested) |
| single part | `esm_class` | `0`, `short_message` = text |
| multipart | `esm_class` | `0x40` (UDHI); `short_message` = 6-byte UDH `05 00 03 ref total seq` + part text |

Parts are split here, not by node-smpp: 153 GSM septets (extension characters cost two and the escape pair is never split) or 67 UTF-16 code units (surrogate pairs kept together) per part, so the count equals `analyseSmsText(text).parts` from `@sendex/core`. The 8-bit concatenation reference is a per-provider counter (1..255). `sar_*` TLVs and `message_payload` are not used.

Encoding is taken from the message, with one safety net: a message marked `GSM_7BIT` whose text contains non-GSM characters is sent as UCS-2 rather than letting node-smpp replace those characters with spaces. A message marked `UCS2` is always sent as UCS-2.

## Outcomes and error codes

Each message resolves to `accepted` with the provider `message_id` from `submit_sm_resp` (for multipart, the first part's id; all part ids are kept in `provider.partIds`), or `failed` with the symbolic SMPP status as `reason`.

| command_status | Name | `retryable` | Meaning |
| --- | --- | --- | --- |
| `0x00` | `ESME_ROK` | n/a | accepted |
| `0x58` | `ESME_RTHROTTLED` | yes | over the account's rate; slow down (`SMPP_TPS`) and retry |
| `0x14` | `ESME_RMSGQFUL` | yes | SMSC queue full; retry later |
| `0x0A` | `ESME_RINVSRCADR` | no | sender id rejected for this account or country |
| `0x0B` | `ESME_RINVDSTADR` | no | destination rejected (bad number, blocked country) |
| `0x08` | `ESME_RSYSERR` | no | SMSC internal error |
| `0x45` | `ESME_RSUBMITFAIL` | no | generic submit failure |
| `0x0D` / `0x0E` / `0x0F` | `ESME_RBINDFAIL` / `ESME_RINVPASWD` / `ESME_RINVSYSID` | bind | `send()` throws `SmppBindError` |
| other | name from node-smpp, else `ESME_0x........` | no | permanent unless the carrier says otherwise |

Transport problems while a part is in flight produce `failed` with `reason: "SESSION_CLOSED"` (link dropped) or `"SUBMIT_TIMEOUT"` (no response within `submitTimeoutMs`, 60 s), both `retryable: true`. The send loop should re-queue retryable failures with backoff and mark the rest failed for good.

## Delivery receipts

With `registered_delivery 1` the SMSC sends one `deliver_sm` per part with `esm_class 0x04`. `provider.parseDeliveryReceipt(pdu)` (also exported as `parseDeliveryReceiptPdu`) reads the SMPP 3.4 appendix B text:

```
id:ABC123 sub:001 dlvrd:001 submit date:2611061530 done date:2611061531 stat:DELIVRD err:000 text:hello wor
```

| Field | Mapped to |
| --- | --- |
| `receipted_message_id` TLV, else `id:` | `providerMessageId` |
| `stat:DELIVRD` / `EXPIRED` / anything else (`UNDELIV`, `REJECTD`, `DELETED`, `UNKNOWN`) | `delivered` / `expired` / `failed` |
| `err:` | `errorCode` (carrier specific, see the account page) |
| `done date:` (`YYMMDDhhmm` or `YYMMDDhhmmss`, treated as UTC) | `at` (falls back to now) |

When there is no receipt text but both `receipted_message_id` and `message_state` TLVs are present, `message_state` decides (2 delivered, 3 expired, else failed). A `deliver_sm` that is not a receipt (an inbound message such as STOP) returns `null` and is handed to `onInboundMessage` listeners instead.

The session acknowledges every `deliver_sm` immediately with `deliver_sm_resp`; the SMSC resends receipts that are not acknowledged.

## Keepalive and reconnect policy

- `enquire_link` every 30 s (`enquireLinkIntervalMs`). If the previous one is still unanswered when the next is due, the link is considered dead and destroyed.
- Any socket error, close, parse error, bind timeout (`connectTimeoutMs`, 10 s) or SMSC `unbind` ends the session. In-flight submits fail with `SESSION_CLOSED` (retryable); queued ones stay queued and go out after the rebind.
- Reconnect with exponential backoff: 1 s, 2 s, 4 s, ... capped at 60 s (`reconnectMinMs` / `reconnectMaxMs`), reset after a successful bind. A refused bind rejects `connect()` / `ready()` with `SmppBindError` and also keeps retrying with the same backoff, since the SMSC may be rejecting binds only temporarily.
- Window: at most `windowSize` (default 10) `submit_sm` await a response at any time. Throughput cap: with `throughputPerSecond` set, submits are spaced at `1000 / tps` ms.
- `provider.session.state` is one of `idle`, `connecting`, `bound`, `reconnecting`, `closed`; `provider.session.binds` counts successful binds (useful for health checks and tests).
- In the worker only the process holding the Redis leader lock `sendex:leader:smpp:<provider>` binds; the others keep their `send` worker paused and retry every 5 s (D2-16, see `docs/engineering/redis-utils.md`, "Leader lock"). A lost lock closes the session and shuts the process down for a clean restart.

## Environment variables

| Variable | Meaning | Default |
| --- | --- | --- |
| `SMPP_HOST` | SMSC host | required |
| `SMPP_PORT` | SMSC port | `2775` (`3550` is the usual TLS port) |
| `SMPP_SYSTEM_ID` | account login (`system_id`) | required |
| `SMPP_PASSWORD` | account password (max 8 characters in SMPP 3.4) | required |
| `SMPP_TLS` | `true` to connect with TLS (`ssmpp://`) | `false` |
| `SMPP_WINDOW` | submit window size | `10` |
| `SMPP_TPS` | submit_sm per second | unlimited |

Secrets live in `.env` (git-ignored), Fly.io secrets for the worker; never in the repo (AGENTS.md rule 7). Carriers whitelist the worker's outbound IP (ADR 0001).

## Testing without a carrier

`startSimulator({ port?, behaviour? })` runs an SMPP server in the same process with `smpp.createServer`. It accepts any bind, answers `submit_sm` with ids `sim-1`, `sim-2`, ... and sends a receipt after `receiptDelayMs` (20 ms). Behaviour knobs:

| Option | Default | Effect |
| --- | --- | --- |
| `invalidDestinationSuffix` | `"99"` | destinations ending so are rejected with `ESME_RINVDSTADR` |
| `undeliverableSuffix` | `"98"` | destinations ending so get an `UNDELIV` receipt (`err:001`) |
| `throttleEvery` | `0` | every Nth submit is answered `ESME_RTHROTTLED` |
| `responseDelayMs` | `0` | delay before `submit_sm_resp` (to observe the window) |
| `receiptDelayMs` | `20` | delay before the receipt |
| `sendReceipts` | `true` | set false to keep tests quiet |
| `bindStatus` | `0` | non-zero refuses binds |
| `submitStatus(pdu, index)` | | full override of the status |

`received` holds every request PDU (binds, `submit_sm`, `enquire_link`, `unbind`) and `stats` counts binds, submits, enquire_links, acknowledged receipts and the maximum in-flight submits. `packages/providers/src/smpp/smpp.integration.test.ts` is the reference usage: it covers 50-message batches, UDH concatenation, UCS-2, throttling, invalid destinations, receipts, the window, throughput, keepalive, unbind and reconnect (close the simulator, restart on the same port, the next send succeeds). The whole providers suite runs in about four seconds and needs no Docker, which is why `docker-compose.yml` has no SMPP service.

For a manual session against the simulator from the worker, start it on a fixed port and point `SMPP_HOST=127.0.0.1 SMPP_PORT=<port>` at it.

## node-smpp quirks worth knowing

- Named ESM imports of `errors`, `consts` or `ESME_*` fail at runtime (they are attached to `module.exports` in a loop). Always `import smpp from "smpp"`.
- A decoded `short_message` is `{ udh?: Buffer[], message: string | Buffer }`, not a string, and the UDH comes back as a list of information elements without the length byte. `receiptTextOf()` handles all shapes.
- `data_coding: 0` with a string `short_message` makes node-smpp GSM-encode it (unpacked septets, one per byte); `data_coding: null` (its default) auto-detects, which we never rely on for outbound traffic.
- `session.on("error")` must always be attached: an unhandled error event would crash the worker on the first connection refusal.
- The library's own `auto_enquire_link_period` is disabled; `SmppSession` runs its own keepalive so an unanswered `enquire_link` can drop the link.
