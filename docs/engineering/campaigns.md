# Campaigns (D1-20 to D1-23)

How the campaign screens are put together, where the numbers come from, and the contract the
sending engine (D2-04) picks up from.

## Layers

```
apps/web/app/(dashboard)/campaigns/page.tsx        campaigns table, filters, New Campaign modal
apps/web/app/(dashboard)/campaigns/[id]/page.tsx   campaign page: header, tabs, send form
apps/web/app/(dashboard)/campaigns/actions.ts      every mutation (server actions)
apps/web/components/campaigns/*                    plain-Tailwind client components
apps/web/lib/campaign-views.ts                     db rows -> serialisable views (dates as ISO, micro-EUR as number)
packages/db/src/queries/campaigns.ts               all reads and writes, scoped by organisation
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
| list, open, estimate                                                | `campaign.view`   |
| create, duplicate, delete, lists, sender ids, texts, links, settings | `campaign.create` |
| send                                                                | `campaign.send`   |

Audit rows (`audit_log`, `target_type = "campaign"`) are written for `campaign.create`,
`campaign.duplicate`, `campaign.delete` (from the actions) and `campaign.send` (inside the
`createLaps` transaction). The Logs tab lists them with `listAuditLog`.

## Available contacts

A list member counts as *available* when it is not `bad`, has no `sent_at`, no `flushed_at`
and its number is not in the organisation's `suppressions`. `availableSql` in
`queries/campaigns.ts` is the single definition; `listsForCountry`, `getCampaign` and the
estimate all use it. The subquery is written with explicit aliases because Drizzle drops
table qualifiers in single-table selects (the outer table must be `lists`, unaliased).

## Routes and prices

`routesForCountry(db, org, country)` returns active platform routes (`organisation_id` null)
that have a `route_prices` row for the country, plus the organisation's own routes whatever
their price. The price is the row with the latest `valid_from` not in the future;
`priceMicro` is `null` when there is none, and such routes cannot be picked.

## The estimate

`estimateSend(db, org, campaignId, { routeIds, sendAll })`:

- keeps only the requested routes that the organisation may use and that have a price;
- runs `planLaps` from `@sendex/core` with the campaign's `test_size`, the lists' available
  counts and the route prices: one lap per (list, route) sending `min(testSize, available)`,
  or with `sendAll` the available contacts of each list split evenly across the routes;
- `smsCount` is the sum of the planned lap counts (equal to `testSize × lists × routes` when
  every list has enough contacts), `costMicro` comes from `estimateCost` at each route's
  price;
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
- `cancelled` is reserved for the stop / emergency-stop flows; the laps table's on/off column
  is read-only until then.

Nothing in the web app changes a lap after it is queued.

## Tests

- `packages/core/src/campaigns.test.ts`: schemas, sender id parsing, `splitAdTexts`,
  timezones, placeholders, preview.
- `packages/db/src/queries/campaigns.test.ts` (PGlite): create, list with aggregates and
  filters, tenancy, sender id dedupe, detail with available counts, routes and prices,
  estimate (test and send-all), `createLaps` and its audit row, refusals, duplicate, delete.
- `apps/web/components/campaigns/format.test.ts`, `schedule.test.ts`: money, CTR, periods,
  totals, CSV, timezone conversion.
- `apps/web/e2e/campaigns.spec.ts`: the happy path against the seeded development
  organisation. Set `PLAYWRIGHT_PORT` when port 3000 is already taken.
