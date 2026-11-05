# ADR 0002: Carriers plug in behind one Provider interface

Date: 2026-11-06. Status: accepted.

## Context

Sendex is an aggregator: it rents routes from providers instead of owning them. The first provider is 23Telecom over SMPP; more will follow over SMPP or HTTP, and customers may bring their own routes. The sending engine, pricing, delivery tracking and sender ID checks must not change when a provider is added.

## Decision

`packages/providers` defines one interface, `Provider`, with four methods: `send(batch)`, `parseDeliveryReceipt(raw)`, `priceFor(route, country)` and `validateSenderId(senderId, country)`. Every provider implements it. A registry maps a route to its provider. `FakeProvider` is the first implementation and is used by development, tests and the Day 1 to Day 2 demo flow; `SmppProvider` (node-smpp) is the first real one.

## Consequences

- The engine, laps, ledger and reporting depend only on the interface.
- Per-message failures are returned as outcomes, never thrown, so one bad number cannot abort a batch.
- Adding a provider is a checklist: implement the interface, register it, add route prices, add an injected-failure integration test, write a runbook page.
