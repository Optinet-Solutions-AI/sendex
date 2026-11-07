# ADR 0009: Custom routes are tenant rows with sealed credentials, billed with a separate fee entry

Date: 2026-11-07. Status: accepted.

## Context

The SMS Edge parity plan (phase E) adds Custom Routes: a tenant connects its own SMPP or HTTP carrier and sends through it next to the platform routes, paying €0.01 per SMS on top. The `routes` table already distinguishes platform rows (`organisation_id` null) from tenant rows, and ADR 0002 left per-route provider instances open. Credentials must not sit in the clear in `routes.config`, and rule 7 keeps secrets out of the repo and the database alike.

## Decision

- **A custom route is a `routes` row of its organisation** with `provider` = `custom-http` or `custom-smpp`, the non-secret settings in `config` (API URL with `{{{from}}}` / `{{{number}}}` / `{{{text}}}`, POST flag, headers, username; or host, port, system id, system type, TLS) and the password **sealed** in the new `routes.secret` column with AES-256-GCM under `CUSTOM_ROUTE_SECRET_KEY` (`packages/db` `secrets.ts`). The web app seals on save and never reads the value back; an edit with a blank password keeps the sealed one.
- **The platform fee is its own ledger entry.** Every message sent on a custom route gets a `fee` entry (new `ledger_kind` value) next to its `debit`, refunded together on failure. The amount comes from `organisation_settings.custom_route_fee_micro` (default 10,000 micro-EUR). Spend reports sum `debit` and `fee`.
- **Routing strategy and exceptions** live in `organisation_settings.routing_strategy` and a `routing_exceptions` table; `orderRoutes` in `packages/core` is the single pure rule, applied wherever routes are offered.
- **Tests are first-class rows** (`sms_tests`) with their own queue (`sms-tests`) and dispatcher on the scheduled tick; test messages are `messages` rows without a campaign or lap (`messages.campaign_id`, `lap_id` and `contact_id` became nullable, `test_id` was added), so they share receipts, operators and the ledger with campaign messages.
- **Operator** is a column on `messages`, filled by a delivery receipt that names one or by the first click that resolved a network; Mobile Networks groups the rest as "Unresolved".
- **Out of this change:** the worker-side provider for custom routes (opening the sealed credentials, building the HTTP or SMPP adapter per route, Test Connection). The send loop cancels a lap on a custom route as "cannot be served" until it lands; the page says so.

## Consequences

- Custom routes can be created, priced, ordered and reported on today; sending through them waits for the worker adapter, which is a contained change behind `SendLapDeps.customProvider`.
- The fee is visible on its own in Billing and reconciles per message; changing the fee changes future sends only.
- Making `campaign_id` and `lap_id` nullable touched every query that joined through laps; campaign reports still inner-join laps and therefore never count test messages, while the custom-route SMS log and Mobile Networks left-join and do.
