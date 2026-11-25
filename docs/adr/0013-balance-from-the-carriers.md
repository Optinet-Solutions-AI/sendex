# ADR 0013: The balance is the carriers' balance, not Sendex's own

Date: 2026-11-25. Status: accepted.

## Context

Sendex kept a prepaid balance per organisation, the sum of its `ledger_entries`, funded by hand ("Record deposit") and debited per SMS. Copied from SMS Edge, where clients prepay the platform. On 24 November 2026 a 1,300 SMS send of Emily's Organization was cancelled for "insufficient balance" (€51.86 in Sendex) while our account at 23Telecom held €417.36. Christian, 25 November: Sendex is ours, so a balance inside it is meaningless; the balance should be 23Telecom's, and with more carriers, more balance.

23Telecom answers `GET /user/balance` with `balance`, `available_balance` (balance plus a €5 credit limit), `currency` and `updated`.

## Decision

- **The balance is the money at the carriers.** A provider adapter may implement `fetchBalance()`; 23Telecom's reads `balance` (the credit limit is not spent). The worker reads every such carrier once a minute on the scheduled tick, and again (if older than 15 seconds) right before a send, an SMS test or a verification checks the balance, and stores it in `carrier_balances` (one row per provider, not a tenant table).
- **An organisation's balance** is the sum of the stored balances of the carriers behind its active routes (its own and the platform's), each once. Every check and display uses it: the top bar, Billing, Dashboard, the campaign send bar, top-ups, the worker's checks before a lap, a test and a verification, and the low balance alert.
- **The account is shared.** Every organisation on 23Telecom sees and spends the same balance.
- **The ledger stays for spend.** Every send still writes its debit (cost per message, campaign and day). Deposits are no longer needed; Billing hides the deposit form when the balance comes from a carrier.
- **Fallback:** when none of an organisation's carriers reports a balance (no balance API, the carrier never answered, development), the ledger sum is the balance, as before.
- A carrier that cannot be read keeps its last stored balance, and the read is logged.

## Consequences

- Organisations sharing a carrier can together spend more than one of them expected; there is no split per organisation. Daily caps remain the per-organisation limit.
- The balance is at most a minute old on screen and 15 seconds old at a send; sends already running in parallel are not reserved against it, so the carrier can still refuse the last messages of a large send when the account runs out.
- Ledger deposits recorded before this (e.g. Emily's €51.86) stay in the history but no longer count while a carrier reports a balance.
