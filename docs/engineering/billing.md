# Billing: ledger, deposits, settings and the audit log

Cards D3-07 (ledger and billing page), D3-08 (balance, manual deposits, low balance alert)
and D3-10 (audit log page). User guide: `docs/using/balance-and-billing.md`.

## Ledger rules

`packages/db/src/schema/ledger.ts` defines `ledger_entries`, the only place money lives
(AGENTS.md rule 6):

- **Append only.** Rows are never updated or deleted. The balance of an organisation is
  `sum(amount_micro)` over its rows (`getBalanceMicro`, or `balanceSql(org)` to embed in a
  statement); there is no balance column anywhere.
- **Micro-EUR.** `amount_micro` is a signed bigint, 1 EUR = 1 000 000. Route prices are also
  in micro-EUR per part, so a EUR 0.0357 message is `-35_700`. Formatting to cents is
  `formatEur` in `packages/core/src/billing.ts` (rounds half away from zero); parsing form
  input is `eurToMicro`, which never goes through a float.
- **Kinds.** `deposit` and `refund` are positive, `debit` negative, `adjustment` either.
- **Idempotency.** `idempotency_key` is unique across the table. A send writes its debit in
  the same transaction as the message, keyed `debit:<message id>`; a retry hits the unique
  index instead of charging twice. Deposits are keyed `deposit:<reference>` (below).
- **References.** `reference_type` / `reference_id` say what the entry is for: `message`
  (the message uuid), `lap`, `campaign`, or the deposit method (`wire`, `crypto`, `manual`)
  with the payment reference.

## Queries (`packages/db/src/queries/ledger.ts`)

All take `(db, organisationId, …)` and scope every statement by organisation. Tested on
PGlite in `ledger.test.ts`.

| Function | What it does |
| --- | --- |
| `getBalanceMicro(db, org)` / `balanceSql(org)` | The balance. |
| `listLedgerEntries(db, org, { kind?, from?, to?, page, pageSize })` | Entries newest first with `total`. `from` is inclusive, `to` exclusive. |
| `recordDeposit(db, org, { amountMicro, method, reference, note, actorUserId })` | Appends a `deposit` row with `idempotency_key = deposit:<reference>`, `reference_type = method`, `reference_id = reference`. A repeated reference throws `DuplicateDepositError` (typed, surfaced to the form as its message); a non-positive amount throws. The audit row is the caller's job. |
| `dailySummary(db, org, { from, to })` | One row per UTC day: `depositsMicro`, `debitsMicro`, `refundsMicro`, `adjustmentsMicro`, `netMicro`, `entries`. The Billing Summary tab and its CSV. |
| `spendByCampaign(db, org, { from, to })` | Debits and refunds with `reference_type = 'message'` joined to `messages` (`messages.id::text = reference_id`) and grouped by campaign: `debitsMicro`, `refundsMicro`, `netMicro`, `messages`. A plain join, correct over clever; if it gets heavy on a partitioned `messages`, group by a campaign prefix in `reference_id` instead. |

## Deposits

`apps/web/app/(dashboard)/billing/actions.ts` → `recordDepositAction`:

1. `requireAction("balance.deposit")` (owners) and `assertRecentAuth()` (sign-in within
   five minutes; the dev stub passes). A stale session returns the `reauth_required`
   message, which the form shows inline.
2. `depositSchema` from `packages/core` validates the form (`amountEur` as a decimal string
   with at most two decimals, `method`, `reference` 1–100 chars, optional `note`) and parses
   the amount to micro-EUR.
3. `recordDeposit`, then `recordAudit` with action `balance.deposit`, target
   `ledger_entry/<id>` and details `{ amountMicro, method, reference }` (as strings; bigint
   does not serialise).
4. `revalidatePath("/", "layout")` so the balance in the shell header is fresh.

Card and PayPal are stage two; the buttons are rendered disabled so the layout matches SMS
Edge from day one.

## Settings and the low balance alert

`packages/db/src/schema/settings.ts` adds `organisation_settings` (one row per organisation,
created on first save; migration `0003_settings_and_caps`):

| Column | Meaning |
| --- | --- |
| `low_balance_threshold_micro` | Alert below this; null disables. |
| `low_balance_emails` | `text[]`, at most five (checked by the Zod schema and `updateSettings`). |
| `low_balance_alerted_at` | When the current dip was alerted; null once rearmed. |
| `daily_message_cap`, `daily_spend_cap_micro` | Null means unlimited. Enforced by the worker when it plans laps (later card). |

Queries in `queries/settings.ts`: `getSettings` (defaults when there is no row),
`updateSettings` (upsert, leaves the alert timestamp alone) and `markLowBalanceAlerted(db,
org, at | null)`.

The decision is pure, in `packages/core/src/billing.ts`:

```
shouldAlertLowBalance({ balanceMicro, thresholdMicro, alertedAt, now })
  → { action: "alert", alertedAt: now }   balance < threshold and alertedAt is null
  → { action: "none" }                    balance < threshold and already alerted
  → { action: "rearm" }                   balance >= threshold (or threshold removed) and alertedAt set
  → { action: "none" }                    balance >= threshold and nothing to clear
```

The worker (later card) runs it after every debit batch and deposit: on `alert` it sends the
email to `low_balance_emails` and calls `markLowBalanceAlerted(now)`; on `rearm` it calls
`markLowBalanceAlerted(null)`. Exactly one email per dip, however many debits follow, and
a new email the next time the balance falls through the threshold.

`updateBillingSettingsAction` is behind `settings.manage` and writes an audit row
`settings.update` with `{ section: "billing", … }`.

## Billing page

`apps/web/app/(dashboard)/billing/page.tsx` is a server component behind `settings.view`
(every role can see the ledger; only owners get the deposit form). Tabs are links
(`?tab=deposits|transactions|summary`) so each panel is server-rendered from
`packages/db`; the filters are plain GET forms. `lib/billing-params.ts` parses and builds
the query string; `dayRangeBounds` turns inclusive ISO days into the `[from, to)` instants
the queries take. `billing/export/route.ts` streams `?report=transactions` (same filters as
the tab) or returns `?report=summary` as CSV; amounts are plain decimals (`eurDecimal`).

The balance in the shell header is read in `app/(dashboard)/layout.tsx` with
`getBalanceMicro`; the layout is `force-dynamic`. Without a session or organisation the
shell hides the balance and the page renders its `AuthErrorView` as before. The nav shows
**Audit log** only when `can(role, "audit.view")`.

## Audit log page

`app/(dashboard)/audit/page.tsx`, behind `audit.view` (owners). `listAuditEntries(db, org, {
action?, actorUserId?, from?, to?, page, pageSize })` in `queries/audit.ts` joins `users` for
the actor name and email (null for worker-written rows, shown as "system");
`listAuditActions` and `listAuditActors` feed the filter selects. `lib/audit-params.ts`
parses the query and renders `details` as a compact `key=value` summary (nested values
elided, full JSON in the tooltip and the CSV). `audit/export/route.ts` streams the filtered
log as CSV.

## Tests

- `packages/core/src/billing.test.ts`: formatting, parsing, the alert rule and the schemas.
- `packages/db/src/queries/ledger.test.ts`, `settings.test.ts`, `audit.test.ts`: PGlite.
- `apps/web/lib/billing-params.test.ts`, `audit-params.test.ts`.
- `apps/web/e2e/billing.spec.ts`: header balance, deposit with a unique reference, duplicate
  refused, tabs and CSVs, audit entry, settings form. Repeatable: the balance grows by EUR 25
  per run.
