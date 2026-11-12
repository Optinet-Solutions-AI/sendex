---
title: Adding a provider
description: Implement the Provider interface from packages/providers, register it, and prove it against injected failures.
---

Every carrier plugs in behind one interface, `Provider`, defined in `packages/providers/src/provider.ts`. Only the worker calls it. The web app never imports a provider.

## The interface

```ts
interface Provider {
  readonly name: string;
  send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]>;
  parseDeliveryReceipt(raw: unknown): DeliveryReceipt | null;
  priceFor(route: string, country: string): Promise<number | null>;
  validateSenderId(senderId: string, country: string): { ok: true } | { ok: false; reason: string };
}
```

- **`send(batch)`** submits a batch of `OutboundMessage` (our uuid `id`, E.164 `to`, `senderId`, `text`, `encoding` of `GSM_7BIT` or `UCS2`, the provider-specific `route`, and the ISO 3166-1 alpha-2 `country`). It must **never throw for a per-message failure**; it returns one `SubmitOutcome` per message, either `{ status: "accepted", providerMessageId }` or `{ status: "failed", reason, retryable }`. The worker uses `retryable` to decide between backoff and marking the message failed.
- **`parseDeliveryReceipt(raw)`** turns whatever the carrier sends back (an SMPP `deliver_sm` text, an HTTP webhook body) into a `DeliveryReceipt` with `providerMessageId`, a `status` of `delivered`, `failed` or `expired`, an optional `errorCode` and the `at` timestamp. Return `null` for anything you cannot parse; the worker logs it and moves on.
- **`priceFor(route, country)`** returns the price per SMS in EUR for that route and country, or `null` if the provider has no such route. The ledger debit uses this times the part count.
- **`validateSenderId(senderId, country)`** says whether a sender ID is acceptable for the country on this provider, with a reason when it is not. Campaign creation calls it for every sender ID in the group.

## Steps

1. Create `packages/providers/src/<name>-provider.ts` exporting a class that implements `Provider`. Keep carrier credentials in constructor options; they come from `.env` in the worker, never from the database.
2. Write the Vitest first: a test file next to it that drives `send`, `parseDeliveryReceipt`, `priceFor` and `validateSenderId` with the same injected failures the `FakeProvider` tests use (rejected numbers, a receipt you cannot parse, an unknown route).
3. Register the class in the provider registry so the worker can construct it by name.
4. Add a **route row** per country with its price in the routes table, through a migration or the seed.
5. Add an integration test in `apps/worker` that runs a lap through the new provider with `FakeProvider`-style failures injected and asserts the ledger and message states.
6. Add a runbook page under `docs/engineering/providers/` with the carrier's connection details (host, port, bind type, throughput limits), how to read its error codes, and who to call when it is down.

## Existing adapters

| Adapter        | Transport                                 | Use                                                          |
| -------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `SmppProvider` | SMPP 3.4 bind, `submit_sm` / `deliver_sm` | Carriers reached over SMPP, including custom routes.         |
| `HttpProvider` | HTTPS JSON with a webhook for receipts    | Carriers with a web API: 23Telecom, the first route.         |
| `FakeProvider` | In memory                                 | Tests and local development; configurable failure injection. |
