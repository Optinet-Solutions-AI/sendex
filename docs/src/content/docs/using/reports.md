---
title: Reports
description: The Campaigns Log, the Send Calendar and the Postback Logs under Campaigns › Reports.
---

Three reports sit under **Campaigns › Reports**. All of them count in UTC days, the way every
date in Sendex is counted, and a message is "sent" once the carrier accepted it (the same
rule as the campaign page). A lead or sale counts on the day its message was sent, so every
row reconciles with its own sends.

## Campaigns Log

**Campaigns › Reports › Campaigns Log** is daily sending broken down by campaign, country,
list and route.

- **Period**: Today, 7d, 30d or Custom (a date range picker appears). **All countries**
  narrows to one or more countries. The count on the right ("72 rows") and **↻ Refresh**
  re-read the log.
- The **KPI strip** totals the filtered log: SENT, CLICKS, CTR, SPEND, CPC (to four
  decimals, "—" without clicks) and LEADS / SALES.
- One **row per day × campaign × country × list × route**, newest day first and busiest
  first within a day: Date, Campaign (a link), Country, List, Route, Sent, Spend, CTR,
  Clicks, CPC, Leads, Sales. Spend is the ledger debit of those messages. Sends that have no
  campaign show "(API / no campaign)" and "—" for the list.
- **Export CSV** downloads the whole filtered log; the page shows 50 rows at a time ("Page 1
  of 2").

## Send Calendar

**Campaigns › Reports › Calendar** shows what went out each day.

- The **KPI strip** is for the visible month or week: Sent, Clicks, CTR, Countries and
  Campaign sends (campaign × day pairs). On the right, "40 country-days with sends".
- **‹ Today ›** move by a month (or a week in the **Week** view). Today's date is a navy
  circle. Days run midnight to midnight UTC, as the "Days in UTC" note beside the title
  says, so ahead of UTC (Manila, for instance) the circle stays on yesterday's date until
  8am local time; the day totals match the Campaigns Log for the same reason.
- Each day cell shows the date, the day's total sent and a navy bar relative to the busiest
  day, then up to three country lines (flag, country, sent, CTR) with "+2 more countries"
  below; the week view lists every country. Hover a line for "Poland — 2,000 sent, 47 clicks
  (2.35%), 1 campaign"; click it for the **day modal**: the campaigns that sent to that
  country that day, with the account that created each one, Sent, Clicks, CTR, Leads, Sales
  and a TOTAL row. The campaign name links to the campaign.
- Under the grid, **Scheduled sends** lists what is queued for the next 30 days, per day in
  each campaign's own timezone.

## Postback Logs

**Campaigns › Reports › Postback Logs** lists every lead and sale your tracker reported.

- Filters: search by event key (or dynamic id), **All events | Leads | Sales**, **All time |
  Today | 7 days | 30 days | 90 days** or a date range, and **✕ Reset** once anything is
  set. The count ("204 events") sits on the right.
- Columns: Event Key (monospace), Type (green **Sale**, grey **Lead**), Campaign (name and
  dynamic id), Parameters ("No extra parameters" when the tracker sent nothing else),
  Received (date, with the time lighter) and ⌄ to expand the row: dynamic id, value, the
  full timestamp and every parameter.
- **Postback URL** opens Settings › Postbacks; **Export CSV** carries the same filters.
  Pages hold 50 events ("Page 1 of 5").

## How the figures are computed

The log and the calendar read the message table live, grouped by day, so a send shows up
the moment the worker accepts it; no nightly job is involved. Three indexes (messages by
organisation and sent time, postbacks by message, ledger entries by reference) keep the
grouping fast. If volumes ever make the live grouping slow, a materialised daily table can
replace it behind the same helpers.
