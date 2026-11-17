# Performance screens (D5 series)

Built from the Business KPIs Manager walkthrough of 11 November 2026 (a partner team's
internal tool, shown to us on a call). That tool is a reporting and planning layer over sending
platforms; these screens put the same layer over Sendex's own data. Not a spec to copy
pixel by pixel: the screens use Sendex's vocabulary and rules.

| That tool | Sendex |
| --- | --- |
| Brand | Offer (a row of `links`) |
| Source (23, …) | Route |
| Provider (ZEN, DER, …) | `lists.provider`, the data provider (D5-01) |
| SU | Lead (a `lead` postback) |
| FTD | Sale (the first `sale` postback of a message) |
| Contacts | SMS sent |
| ROI % = revenue ÷ cost | ROI = profit ÷ cost, the dashboard's definition (reads 100 points lower) |

## The preview switch (D5-09)

Everything in the D5 series is hidden unless the organisation has
`organisations.preview_features` set to true (migration `0027_preview_features`, false by
default). It lets one organisation test on the live app while every other account sees the
app as it was.

- `OrgContext.previewFeatures` (`apps/web/lib/auth.ts`) carries the flag; it comes with the
  organisation row the request already loads, so it costs no extra query.
- **Menu.** The Performance group is marked `preview` in `components/shell/nav.ts`; the shell
  calls `visibleNav(can, tree, { preview })`.
- **Pages.** `<RequireOrg action="campaign.view" preview>` answers "not found" for an
  organisation without the preview. The page streams, so the HTTP status stays 200.
- **Server actions.** `requirePreviewAction` refuses with 403, so a hidden screen's actions
  cannot be called either (`kpi/actions.ts`, `setListProviderAction`).
- **Data provider.** The upload form gets `showProvider`, the list page shows `ListProvider`
  only with the preview on, and `startUpload` drops a provider sent by an organisation without
  it.
- There is no screen for the switch. `setOrganisationPreview(db, organisationId, on)` exists
  for scripts; on the live database it is one statement, run by whoever operates the platform:
  `update organisations set preview_features = true where slug = '<organisation slug>';`
- The demo activity seed switches it on for the demo organisation, so `pnpm dev:demo` shows
  everything.

To open the features to everyone later: either set the flag for every organisation, or remove
the `preview` marks in a follow-up PR.

## Layers

1. **`packages/core/src/kpi.ts`**, pure: `KpiCounters` (sent, leads, sales, cost, revenue),
   the ratios (`leadToSale`, `roi`, `smsPerSale`, cost / revenue / profit per sale) and
   `groupListFollowUp`.
2. **`packages/db/src/queries/kpi.ts`**: read models on the dashboard's `messageFacts`
   (`queries/dashboard.ts`), so the rules are the same everywhere: scoped by organisation,
   sends / leads / cost windowed on `messages.sent_at`, sales / revenue on the first deposit
   (D4-17). `KpiFilter` adds a route, an offer and a list-name search to the dashboard filter.
3. **`apps/web/lib/kpi-params.ts`**: the query-string state of each screen and its database
   filter (whole UTC days, end day included).
4. **`apps/web/app/(dashboard)/kpi/…`** pages (server components, `campaign.view`) and
   **`apps/web/components/kpi/…`** client components. Money crosses the boundary as micro-EUR
   strings.

The sidebar group is **Performance** (`components/shell/nav.ts`).

## List Follow-Up (D5-03)

`/kpi/list-follow-up?q=&route=&offer=&country=&from=&to=`

- `listFollowUp(db, organisationId, filter)` returns every list that is not archived, left
  joined to its facts inside the filter: sent, leads, sales, cost, revenue and the last send.
  A list with nothing inside the filter comes back with zeros, which is what makes "never sent
  to this offer" fall out of the same query.
- `groupListFollowUp(rows)` splits them: lists with a send or a sale are grouped by country
  with the country's totals (countries by ROI, best first; lists by sales), the rest are the
  untouched lists (by country, then name).
- `kpiFilterOptions` feeds the Route and Offer selects (routes that have laps, the
  organisation's links) and returns the list countries and data providers for later screens.

## Performance Insight (D5-04)

`/kpi/insight?period=month|year|all&year=&month=&sort=roi|sales`

- `kpiByOfferCountry(db, organisationId, filter)` returns one row per offer and country
  inside the window. Everything on the page is derived from those rows in `packages/core`:
  `insightTotals` (the eight tiles), `rollUp` (per offer, per country),
  `topOffersByCountry` (five per country, by ROI or by sales) and `efficiencySnapshot`
  (the six offers with the fewest SMS per sale).
- `parseInsightQuery` defaults to the current UTC month; `insightWindow` turns the period into
  the window, `insightLabel` into "November 2026", "2026" or "All time".
- The bars are plain CSS (`BarList` in `components/kpi/insight.tsx`), sized against the
  largest absolute value, red when negative. No chart library.

## Sales Results (D5-05)

`/kpi/sales-results?period=month|year|all&year=&month=&sort=sales|day|leads|revenue`

- `salesResults(db, organisationId, filter)` groups the facts by day, offer, route, country,
  list and the list's provider and keeps the groups with a lead or a sale. Leads sit on the
  day the SMS was sent, sales and revenue on the day of the deposit, so one list can have a
  leads-only line and, days later, a sales-only line.
- `sortSalesResults` (core) orders by a column, largest or latest first; the page sorts on the
  server so the order is part of the URL.
- `PeriodQuery` and `components/kpi/period-filter.tsx` are the Month / Year / All time control
  shared with Insight.

## Trends (D5-06)

`/kpi/trends?year=&month=&by=route|offer|country|provider&mode=daily&compare=0`

- `kpiDaily(db, organisationId, filter, by)` returns leads and sales per day and group. The
  page calls it for the month and for the month before (`trendsWindows`).
- Pure parts in `packages/core/src/kpi.ts`:
  - `throughDay(year, month, now)`: today for the month in progress, the last day for a past
    month, 0 for a future one;
  - `trendSummary`: the month through that day against the same days of the month before
    (changes as fractions, the conversion change in points, null without a base);
  - `trendSeries`: one point per day, daily or running, null after the day reached, with the
    month before alongside;
  - `trendBreakdown`: per group, the month, its two halves and the direction between them.
- The charts are the `Lines` component of `@sendex/ui` inside `ChartFrame`; the month before
  is the dashed series.

## Campaign creator (D5-07)

A dialog on List Follow-Up (`components/kpi/campaign-creator.tsx`), for `campaign.create`.

- `campaignCreatorDataAction(period)` returns everything one data period needs: offers, lists,
  `kpiByOfferCountry` and `listOfferPairs` inside the period and with no window, and
  `routesForCountry` for each list country. The dialog ranks on the client with the pure
  functions of `packages/core/src/kpi.ts`: `rankOffersForCountry`, `rankCountriesForOffer`,
  `rankListsForOffer`. "Never sent" comes from the all-time rows, the figures from the period.
- `creatorPeriod(period, now)` gives the window and its label: this month to today, or the
  last 1, 3, 6 or 12 whole months.
- `createPlannedCampaignAction` validates with `plannedCampaignSchema`, checks the list's
  country is open (`assertCountryOpen`, D4-19) and calls `createPlannedCampaign`, which checks
  the list, the offer and that the route can carry the list's country, then writes the
  campaign, `campaign_lists`, `campaign_links` and `campaign_routes` in one transaction.
- `campaigns.planned_for` (date, migration `0025_campaign_planned_for`) is the planned day. It
  is a plan only: the scheduler reads `scheduled_at` and never this column, so a planned
  campaign stays a draft until someone sends it.

## Daily plan (D5-08)

`/kpi/daily-plan?day=YYYY-MM-DD&by=country|offer|route`

- `dailyPlan(db, organisationId, day)` returns the campaigns whose `planned_for` is that day
  with their offer, lists, picked routes, the numbers in their lists and what they have sent.
- `planGroups(rows, by)` and `planTotals(rows, target)` (core) make the group table and the
  tiles; the difference is contacts minus target.
- `organisation_settings.daily_send_target` (integer, null for none; migration
  `0026_daily_send_target`) with `getDailySendTarget` / `setDailySendTarget`. It is a goal the
  plan is compared with and is never read by the sending engine; the caps are separate.
- `setDailyTargetAction` needs `settings.manage` (owner) and is audited as
  `settings.daily_target`; `dailyTargetSchema` takes a whole number or blank.

## Tests

- `packages/core/src/kpi.test.ts`: the ratios and the grouping.
- `packages/db/src/queries/kpi.test.ts`: runs on the demo seed plus the demo activity (D5-02)
  in PGlite; totals reconcile with `dashboardKpis`, each filter narrows as described, and
  another organisation sees nothing.
- `apps/web/lib/kpi-params.test.ts`: parsing, the query string round trip, the window.
- The preview switch: `tenancy.test.ts` (off by default, on and off per organisation),
  `nav.test.ts` (the group is hidden without it), `auth.test.ts` (`requirePreviewAction`) and
  `e2e/preview-switch.spec.ts`, which switches the demo organisation off and on again.
- `apps/web/e2e/list-follow-up.spec.ts`, `insight.spec.ts`, `sales-results.spec.ts` and
  `trends.spec.ts` (which asks `latestDemoMonth()` for the month to open) and
  `campaign-creator.spec.ts` (which deletes the drafts it makes) and `daily-plan.spec.ts`
  (which plans two campaigns for a far-off day and removes them): on the demo
  activity (`e2e/helpers/demo.ts` runs `pnpm db:seed:activity` first). The Insight spec uses
  the all-time view because the demo sends are dated relative to the day they were seeded.
