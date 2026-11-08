# Campaigns (D1-20 to D1-23, D3-05, D3-06)

How the campaign screens are put together, where the numbers come from, and the contract the
sending engine (D2-04) picks up from.

## Layers

```
apps/web/app/(dashboard)/campaigns/page.tsx        campaigns table, filters, New Campaign modal
apps/web/app/(dashboard)/campaigns/export/route.ts CSV of the filtered campaigns (same query string)
apps/web/app/(dashboard)/campaigns/[id]/page.tsx   campaign page: header, tabs, send form, results
apps/web/app/(dashboard)/campaigns/actions.ts      every mutation (server actions)
apps/web/components/campaigns/*                    plain-Tailwind client components
apps/web/lib/campaign-views.ts                     db rows -> serialisable views (dates as ISO, micro-EUR as number)
apps/web/lib/campaigns-params.ts                   list filters <-> query string <-> listCampaigns input
packages/db/src/queries/campaigns.ts               all reads and writes, scoped by organisation
packages/db/src/queries/results.ts                 campaignResults, setLapOn (D3-05)
packages/core/src/results.ts                       ratioOf, costPerMicro, resultRates, formatPercent (pure)
packages/db/src/queries/audit.ts                   recordAudit / listAuditLog
packages/core/src/campaigns.ts                     Zod schemas, country -> timezone table, placeholders, preview
packages/core/src/laps.ts, send-count.ts           planLaps, estimateCost, sendCount (pure maths)
```

Rules from AGENTS.md apply: pages are server components that call `@sendex/db` helpers with
the organisation id from `requireOrg()`; every mutation is a server action that parses its
input with a `@sendex/core` schema and runs under `requireAction(...)`; nothing in the web
app talks to a carrier.

## Data flow on the campaign page

1. `[id]/page.tsx` resolves the tenant, loads `getCampaign` (campaign + lists with available
   counts + sender id group + ad texts + links + laps), the sender id groups and lists for the
   campaign country, the organisation's links, `routesForCountry` and the campaign's audit
   entries, converts them with `lib/campaign-views.ts` and renders `SendForm`.
2. Each panel saves its own change through a server action (`setCampaignListsAction`,
   `setCampaignSidGroupAction`, `addAdTextsAction`, `createLinkAction`,
   `updateSendSettingsAction`, ...). Actions call `revalidatePath` for the campaign page, so
   the server component re-renders and the panels receive fresh props; the panel also calls
   `onChanged()`, which bumps a counter in `SendForm`.
3. The picked **routes** and the **send all** switch are not persisted (there is no
   campaign_routes table in v1); they live in `SendForm` state and travel with each
   estimate and with the send.
4. `SendForm` calls `estimateSendAction({ campaignId, routeIds, sendAll })` whenever the
   routes, the mode or the saved campaign change; the result feeds the footer (CONTACTS,
   SIDS, TEXTS, LINKS, TEST SIZE, SMS, COST).
5. **Send** calls `sendCampaignAction`, which calls `createLaps`; the refreshed campaign
   shows the queued laps under the form.

Checkbox panels that are driven by server props (lists) keep an optimistic local copy so the
click shows at once and is re-synced when the refreshed props arrive.

## Permissions and audit

| Action                                                              | Permission        |
| ------------------------------------------------------------------- | ----------------- |
| list, open, estimate, results, CSV export                           | `campaign.view`   |
| create, duplicate, delete, lists, sender ids, texts, links, settings | `campaign.create` |
| send, lap on/off                                                    | `campaign.send`   |

Audit rows (`audit_log`, `target_type = "campaign"`) are written for `campaign.create`,
`campaign.duplicate`, `campaign.delete` (from the actions), `campaign.send` (inside the
`createLaps` transaction) and `lap.toggle` (from `setLapOn`). The Logs tab lists them with
`listAuditLog`.
| send, resume, change or cancel the schedule                         | `campaign.send`   |
| pause, stop                                                         | `campaign.stop`   |
| emergency stop (Settings, owners)                                   | `emergency.stop`  |

Audit rows (`audit_log`, `target_type = "campaign"`) are written for `campaign.create`,
`campaign.duplicate`, `campaign.delete` (from the actions), `campaign.send` (inside the
`createLaps` transaction) and, from the control helpers in `queries/campaign-control.ts`,
`campaign.pause`, `campaign.resume`, `campaign.stop`, `campaign.reschedule` and
`campaign.schedule_cancel` (plus `lap.cancel` per cancelled lap). The Logs tab lists them with
`listAuditLog`. The emergency stop writes `emergency.stop` / `emergency.clear` against the
organisation.

## Pause, resume, stop and the schedule (D2-08, D2-09)

`components/campaigns/campaign-controls.tsx` sits under the header: Pause / Resume / Stop
(Stop behind a confirm dialog that states how many contacts remain) and, while the campaign is
`scheduled`, the schedule editor (change time, cancel schedule). Which buttons show follows
`canTransition` from `@sendex/core`, the same rules the server applies. The actions are in
`app/(dashboard)/campaigns/control-actions.ts`; the state changes and what they do to laps and
messages are described in `sending-engine.md` ("The control surface"). `/campaigns/scheduled`
lists upcoming sends per day in each campaign's timezone (`listScheduledCampaigns`). The
owner-only emergency stop lives under `/settings/emergency-stop` and talks to the worker
through `lib/worker-api.ts`; `app/(dashboard)/emergency-stop-banner.tsx` shows the red bar.
How-to: `docs/using/schedule-pause-stop.md`.

## Available contacts

A list member counts as *available* when it is not `bad`, was never sent or was flushed after
its last send (`sent_at is null or flushed_at > sent_at`, the same rule as the engine's
`alreadySent` filter) and its number is not in the organisation's `suppressions`. `availableSql` in
`queries/campaigns.ts` is the single definition; `listsForCountry`, `getCampaign` and the
estimate all use it. The subquery is written with explicit aliases because Drizzle drops
table qualifiers in single-table selects (the outer table must be `lists`, unaliased).

## Routes and prices

`routesForCountry(db, org, country)` returns active platform routes (`organisation_id` null)
that have a `route_prices` row for the country, plus the organisation's own routes whatever
their price. The price is the row with the latest `valid_from` not in the future;
`priceMicro` is `null` when there is none, and such routes cannot be picked.

## The estimate

`estimateSend(db, org, campaignId, { routeIds, sendAll, linkLength })`:

- keeps only the requested routes that the organisation may use and that have a price;
- runs `planLaps` from `@sendex/core` with the campaign's `test_size`, the lists' available
  counts and the route prices: one lap per (list, route) sending `min(testSize, available)`,
  or with `sendAll` the available contacts of each list split evenly across the routes;
- `smsCount` is the sum of the planned lap counts (equal to `testSize × lists × routes` when
  every list has enough contacts), `costMicro` is the sum of the planned laps' cost: count ×
  route price × SMS parts per message. Parts per message is `campaignMessageParts` from
  `@sendex/core`: the longest active text as sent (`{{domain}}` at `linkLength`, empty when no
  link is on), the same rule as the send loop's balance check, so the estimate is never below
  the charge. The web app and the public API pass `shortLinkLength(LINKS_BASE_URL)`; without it
  the link counts 50 characters. `topUpLaps` uses the same parts, so a top-up buys
  `amount ÷ (price × parts)` messages per lap;
- also returns `contacts` (sum of available), `sids` (active sender ids in the group),
  `texts` (active), `links` (active), the planned laps and the resolved routes.

## Lap contract for the sending engine (D2-04)

`createLaps(db, org, campaignId, { routeIds, sendAll, actorUserId })` refuses to run without
a list, a priced route, an active ad text or an active sender id, then in one transaction:

1. inserts one `laps` row per planned lap with
   - `status = 'queued'`,
   - `test_size` = the number of contacts this lap must send (the planned count, not the
     campaign default),
   - `list_id`, `route_id`, `campaign_id`, `organisation_id`,
   - zeroed counters (`sent`, `delivered`, `failed`, `clicks`, `leads`, `sales`,
     `cost_micro = 0`), `rank = null`, `started_at = null`, `finished_at = null`;
2. sets the campaign status to `scheduled` when `campaigns.scheduled_at` is in the future,
   else `sending`;
3. writes an `audit_log` row `campaign.send` with `lapIds`, `routeIds`, `listIds`,
   `sendAll`, `testSize`, `smsCount`, `costMicro` (string) and `scheduledAt`.

What the engine owns from there:

- pick up `queued` laps of `sending` campaigns (and of `scheduled` campaigns once
  `scheduled_at` has passed), set `status = 'sending'` and `started_at`;
- choose contacts from the lap's list that are still available, honouring the campaign's
  `contact_reuse` (`account_wide`: skip numbers any campaign of the organisation has
  messaged; `per_campaign`: skip only this campaign's), up to `test_size`;
- rotate through the group's active sender ids and the campaign's active ad texts by
  `position`, fill placeholders, replace `{{domain}}` with the tracked short link of an
  active campaign link;
- debit the ledger and update `sent`, `delivered`, `failed`, `cost_micro` as receipts and
  clicks arrive (`clicks`, `leads`, `sales` from the tracking tables);
- set `status = 'done'` and `finished_at`, and `rank` the laps of a test round with
  `rankLaps` from `@sendex/core`;
- `cancelled` is written by the stop / emergency-stop flows and by the lap switch below.

The only lap change the web app makes after queueing is the on/off switch (`setLapOn`).

## Results page (D3-05)

`campaignResults(db, org, campaignId)` in `queries/results.ts` returns, or null for another
tenant's campaign:

- `totals`: `sumResultCounters` over the campaign's laps (`sent`, `delivered`, `failed`,
  `clicks`, `leads`, `sales`, `cost_micro`, `revenue_micro`) plus `resultRates` (CTR, delivery
  and failure rate, CPC / CPL / CPS as bigint micro-EUR, `costPerMicro` rounds half up and is
  null without a count);
- `laps`: `LapSummary` rows with the same rates and `on = status !== 'cancelled'`, ordered by
  `rank asc nulls last`, then creation;
- `networks`: one row per route of the campaign's messages with `sent` (status `sent`,
  `delivered` or `expired`, i.e. accepted by the carrier), `delivered`, `failed` (`failed` or
  `expired`), clicks (joined through `messages.route_id`), CTR, delivery rate and the cost of
  the laps on that route. `source` is `"route"`: messages have no operator column, and the
  Analytics tab says so; when receipts bring the operator the breakdown switches to it;
- `clicksPerHour`: clicks grouped by `floor((at - first_sent) / 1h)`, where `first_sent` is
  `min(messages.sent_at)` falling back to the earliest `laps.started_at`; empty hours are not
  returned, the view renders what it gets;
- `clicksPerLink`: messages grouped by `link_id` (null -> "No link") with submitted count,
  clicks and CTR.

The lap counters are the source of the header and the lap table because the engine keeps them
current; the breakdowns are re-counted from `messages` and `clicks` so a discrepancy shows up.
`results.test.ts` seeds both and asserts they agree with raw counts.

The web layer computes the same rates with `resultRates` from `@sendex/core` where it only has
`LapView`s (the lap table under the send form), so the two paths cannot diverge. The derived
numbers reach the client as numbers (`lib/campaign-views.ts: toResultsView`).

### Lap on/off

`setLapOn(db, org, { lapId, on, actorUserId })` reuses `laps.status` rather than adding a
column, so the engine honours the switch with no change on its side:

| From        | on = false                                                        | on = true          |
| ----------- | ----------------------------------------------------------------- | ------------------ |
| `queued`    | `cancelled` via the sending store's `cancelLap` (refunds queued messages, writes `lap.cancel`) | no-op |
| `sending`   | same; the running job sees `cancelled` on its next batch           | no-op              |
| `cancelled` | no-op                                                             | `queued`, `finished_at` cleared; the dispatcher claims it again and `send-lap` continues with `test_size - existing messages` |
| `done`      | throws                                                            | throws             |

Every call writes `lap.toggle` on the campaign (`details: { lapId, on, from, to }`). The
action is `toggleLapAction` (`campaign.send`); the table disables the switch for `done` laps
and for roles that cannot send.

## Campaigns list (D3-06)

`listCampaigns` keeps its signature and takes optional filters: `from` / `to` (the sending
period `[coalesce(first_lap_at, created_at), coalesce(last_lap_at, created_at)]` overlaps
`[from, to)`), `hasLeads`, `hasSales`, `noClicks`, `spendMinMicro` / `spendMaxMicro`
(inclusive, on `coalesce(sum(cost_micro), 0)`), and `pageSize` (default 25; the export walks
pages of 500). The filters are applied to the campaign row joined to the per-campaign lap
aggregate, and the total count uses the same join. `lib/campaigns-params.ts` parses the query
string (`search, country, status, from, to, hasLeads, hasSales, noClicks, spendMin, spendMax,
page`) and builds the `listCampaigns` input; the page and `export/route.ts` share it so the
CSV always equals the filtered table.
The only way the web app changes a lap after it is queued is through the control helpers
(`stopCampaign`, `cancelSchedule`), which move `queued` / `sending` laps to `cancelled`; see
`sending-engine.md`, "The control surface".

## Tests

- `packages/core/src/campaigns.test.ts`: schemas, sender id parsing, `splitAdTexts`,
  timezones, placeholders, preview.
- `packages/db/src/queries/campaigns.test.ts` (PGlite): create, list with aggregates and
  filters, tenancy, sender id dedupe, detail with available counts, routes and prices,
  estimate (test and send-all), `createLaps` and its audit row, refusals, duplicate, delete.
- `packages/db/src/queries/results.test.ts` (PGlite): `campaignResults` against raw sums and
  counts over seeded laps, messages and clicks; `setLapOn` off / on / refusals and its audit
  rows; the new `listCampaigns` filters and page size.
- `packages/core/src/results.test.ts`: the rate and cost-per maths.
- `apps/web/lib/campaigns-params.test.ts`: query string parsing and the `listCampaigns` input.
- `apps/web/components/campaigns/format.test.ts`, `schedule.test.ts`: money, CTR, periods,
  totals, CSV, timezone conversion.
- `apps/web/e2e/campaigns.spec.ts`: the happy path against the seeded development
  organisation. Set `PLAYWRIGHT_PORT` when port 3000 is already taken.
- `apps/web/e2e/campaign-results.spec.ts`: seeds a campaign with laps, messages and clicks
  (`seedE2eResults`) and checks the header, the ranked lap table, the switch and the
  Analytics tab against SQL counts.
- `apps/web/e2e/campaigns-list.spec.ts`: the sales / no-clicks / spend filters, the CSV
  export and Duplicate from the actions menu.
- `apps/web/e2e/campaign-control.spec.ts`: pause, resume and stop on a seeded sending
  campaign (badges, lap rows, Logs tab); change and cancel the schedule of a seeded scheduled
  campaign, including its row on `/campaigns/scheduled`.
- `apps/web/lib/worker-api.test.ts`: the internal API client (config fallbacks, headers,
  error mapping, answer parsing).
