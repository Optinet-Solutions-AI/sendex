---
title: "Billing: ledger, deposits, settings and the audit log"
description: How the ledger, deposits, daily summary, settings and caps are built.
---

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

1. `requireAction("balance.deposit")` (owners) and `requireRecentAuth()` (sign-in within
   five minutes; the dev stub passes). A stale session returns Clerk's reverification hint;
   the form calls the action through `useReauthAction`, so Clerk asks for the password in a
   dialog and the deposit is then recorded (D4-15, `docs/engineering/auth.md`).
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
| `daily_message_cap`, `daily_spend_cap_micro` | Null means unlimited. Enforced by the send loop before every batch (D3-11, see "Daily caps and alerts" below and `sending-engine.md`). |

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

The worker runs it from the dispatcher tick (`apps/worker/src/alerts/checks.ts`, D3-11) for
every organisation with a threshold set or an alert still to rearm
(`organisationsWithLowBalanceRule`), at most once per five minutes per organisation: on
`alert` it raises a `low_balance` alert (below) and calls `markLowBalanceAlerted(now)`; on
`rearm` it calls `markLowBalanceAlerted(null)`. Exactly one alert per dip, however many
debits follow, and a new one the next time the balance falls through the threshold. Email
delivery to `low_balance_emails` is a later card; the alert row carries `recipients` for it.

`updateBillingSettingsAction` is behind `settings.manage` and writes an audit row
`settings.update` with `{ section: "billing", … }`.

## Daily caps and alerts (D3-11)

User guide: `docs/using/caps-and-alerts.md`. Migration `0005_caps_and_alerts`.

**Rules** (pure, `packages/core/src/caps.ts`):

```
capDecision({ sentToday, spentTodayMicro, batchSize, batchCostMicro, caps })
  → { action: "allow" }                              the batch fits (or no cap is set)
  → { action: "trim", allowed, reason }              only `allowed` fit; reason = the tighter cap
  → { action: "refuse", reason }                     not one more message today
spikeDecision({ lastHour, sevenDayHourlyAverage })
  → { spike: true, ratio }  lastHour > 5 x average and lastHour >= 100 (ratio Infinity on a zero average)
  → { spike: false }
```

The spend allowance divides what is left of the cap by the batch's average cost per message
(rounded up). On a tie the message cap is named. `alertPayloadSchema` validates what goes
into an alert row: `kind` (`daily_message_cap`, `daily_spend_cap`, `send_spike`,
`low_balance`), `periodKey`, `message`, JSON-scalar `details` (bigints as strings).

**Usage** (`packages/db/src/queries/usage.ts`): `dailyUsage(db, org, dayStartUtc)` counts the
organisation's messages created since midnight UTC in any status but `cancelled`, and the
net of its `reference_type = 'message'` ledger entries since then (debits less refunds,
clamped at zero). `sendRate(db, org, now)` gives the last hour and the previous 168 hours'
average for the spike rule. "Today" is the UTC day everywhere (`startOfUtcDay`).

**Alerts** (`packages/db/src/schema/alerts.ts`, `queries/alerts.ts`): `organisation_alerts`
is unique on `(organisation_id, kind, period_key)`, so `raiseAlert` is idempotent: the first
call inserts the row and an audit entry `alert.raise`, later calls return the stored row with
`created: false`. The period key is the UTC day for the caps and the UTC hour for spike and
low balance, which is what "at most once per hour" means. `listOpenAlerts` feeds the
dashboard banner (`app/(dashboard)/alerts-banner.tsx`, rendered by the layout for every
page); `acknowledgeAlert(db, org, { alertId, userId })` is owner-only through
`acknowledgeAlertAction` (`settings.manage`) and writes `alert.acknowledge` with the actor.

**Enforcement** is in the send loop (`sending-engine.md`, "Daily caps"); the `CapsStore`
(`queries/caps.ts`) gives it the caps, the usage, `recordLapRefusal` (`laps.refused`,
`laps.refusal_reason`), `pauseCampaign` (audit `campaign.pause` with `by: "worker"`) and
`raiseAlert`. The spike check runs from the dispatcher tick, once per five minutes per
organisation (Redis `SET NX PX` keys `sendex:alerts:spike:<org>` / `sendex:alerts:balance:<org>`).

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
