---
title: Performance
description: The Performance screens. Insight gives a period's totals and where sales come from, Sales Results the day-by-day record, Trends the month against the month before, and List Follow-Up the lists used and untouched.
---

:::note
These screens, and the **Data provider** field on lists, are in preview. They are shown only
to organisations that have the preview switched on; everyone else sees the app without them.
Some organisations get an **Existing / New** switch in the top bar instead: Existing is the app
as before, New adds these screens with your own numbers. The choice is yours alone and is
remembered in your browser.
:::

The **Performance** group in the sidebar holds the screens for deciding what to send next.
They read the same sends, registrations (leads) and first deposits (sales) as the dashboard
and the Campaigns Log, and follow the same rule: sends, leads and cost belong to the day the
SMS went out, sales and revenue to the day the deposit was made.

Words used on these screens:

| Here | Means |
| --- | --- |
| Offer | the tracked link of the brand the SMS advertises |
| Route | the provider line the SMS went out on |
| Leads | registrations reported by the tracker |
| Sales | first deposits reported by the tracker, one per SMS |
| Lead → sale | sales divided by leads |
| ROI | profit divided by cost, as on the dashboard (profit is revenue minus cost) |
| Data provider | who supplied a list, set on upload or on the list's page |

## Insight

**Performance → Insight** is the review of a period: a month (the current one to start with),
a year or all time.

- **Totals**: sales, revenue, cost and net profit.
- **Per sale**: what one sale cost, what it brought, the profit on it, and **SMS per sale**:
  how many SMS it took to get one sale. A low number is a good combination; it moves as new
  results come in, so it shows what works now and not what worked a month ago.
- **Revenue and cost**, **Top offers by ROI**, **ROI by country** and **Sales by country**:
  ranked bars. A red bar is a loss.
- **Offer performance by country**: each country opens to its five best offers, ranked by
  ROI or by sales (the switch on the right), with sent, leads, sales, lead → sale, cost,
  revenue and ROI.
- **SMS per sale**: the six offers that need the fewest SMS to get one sale.

A period with no sends and no sales says so instead of showing empty charts.

## Sales Results

**Performance → Sales Results** is the day-by-day record: one line per day, offer, route,
country and list, with the list's data provider, the **leads** of the SMS sent that day, the
**sales** (first deposits) made that day and their **revenue**. Nobody types it in: it is
read from the postbacks, and revenue is the amount the postback reported or, without one, the
offer's payout.

- Pick a month, a year or all time, as on Insight.
- The table starts with the most sales first. Click **Date**, **Leads**, **Sales** or
  **Revenue** to order by that column, largest or latest first.
- Days with no lead and no sale are left out.
- The strip above shows the period's leads, sales, lead → sale and revenue.

Use it to tell a data owner what their list produced: every line carries the list and its
data provider.

## Trends

**Performance → Trends** shows how a month is doing against the month before.

- **The tiles**: leads, sales and lead → sale for the month so far, each with the change
  against the same days of the month before ("through day 16"). The conversion change is in
  percentage points.
- **Two charts**, leads and sales, one point per day. **Cumulative** (the default) draws
  running totals, **Daily** the figure of each day. The dotted line is the month before; untick
  **vs the month before** to hide it. For the month in progress the line stops at today.
- **Breakdown**: the month per route, offer, country or data provider (the **Group by**
  select), with leads, sales, lead → sale, the conversion of days 1 to 15 and of day 16 to the
  end, and an arrow saying whether the second half converts better or worse than the first.
  The arrow needs leads in both halves.

Leads count on the day their SMS went out and sales on the day of the deposit, as everywhere
else.

## List Follow-Up

**Performance → List Follow-Up** answers three questions: which lists have I used, what did
they bring, and which lists have I not touched yet.

- **The table** has one row per country that has at least one sent list, best ROI first:
  how many lists were sent, the last send, SMS sent, leads, sales, lead → sale, cost, revenue
  and ROI. The arrow on the left opens the country's lists, each with the same figures, its
  size and its data provider. A list name opens the list.
- **Not sent yet** lists every list with no SMS inside the filters, with its country, data
  provider, size and the day it was created. Archived lists are left out.

The filters above the table:

- **Search list name**: type part of a name and press Enter.
- **Route** and **Offer**: only that route's or that offer's sends count. With an offer picked,
  the lower card becomes **Never sent to** that offer: the lists you can still send it to.
- **Countries** and **Date Range**: sends are counted on the day they went out, sales on the
  day the deposit was made.
- **Clear filters** puts everything back.

The filters live in the address bar, so a view can be bookmarked or sent to a colleague.

## Create Campaign

The **Create Campaign** button on List Follow-Up helps you decide what to send next and sets
the campaign up for you. People who may create campaigns see it.

1. **Data period**: this month, last month, or the last 3, 6 or 12 months. The rankings below
   use that period.
2. **Choose a way in**:
   - **By Country**: pick a country and see its offers, best ROI first, with lead → sale and
     sales. Offers never sent to that country are marked **Never sent**.
   - **By Offer**: pick an offer and see the countries it was sent to, best ROI first.
   - **By List**: pick a list (lists that were never sent are marked), then an offer; the
     offers this list never received are marked **Never sent to this list**.
3. **Select a list**: the lists of the country, with the ones **never sent to that offer**
   first (largest first), then the others by their sales in the period.
4. **Route and day**: pick a route that can carry the country (its price per SMS is shown) and
   the day the campaign is planned for, then **Add campaign**.

The result is a **draft campaign** named "Offer → List" with the list, the offer's link and
the route already attached, and the planned day recorded. **Nothing is sent and nothing is
scheduled.** Open it from Campaigns, add the sender IDs and the text, and send it as usual.

"Never sent" always looks at the whole history, not only the data period: a list sent to an
offer a year ago is not offered as fresh.

## Daily Plan

**Performance → Daily Plan** shows what is planned for a day: every campaign whose planned
day (set in **Create Campaign**) is that day.

- **The day**: today to start with. The arrows step a day back or forward and the date field
  jumps to any day, so yesterday's plan stays on record.
- **Tiles**: campaigns, contacts (the numbers in the campaigns' lists), the **daily target**
  and the **difference** between the contacts planned and the target. Red means the day is
  short of the target.
- **Group by** country, offer or route: campaigns and contacts per group.
- **Campaigns of the day**: each campaign with its country, offer, list, route, contacts, what
  it has sent so far and its status. The name opens the campaign.

The **daily target** is how many SMS you mean to send per day. The owner sets or changes it
with the link under the tiles; leave it blank for no target. It is a goal to plan against, not
a cap: it never blocks a send. (The caps are in Settings → Billing.)
