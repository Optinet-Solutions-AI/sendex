---
title: Performance
description: The Performance screens. Insight gives a period's totals and where sales come from, Sales Results the day-by-day record, Trends the month against the month before, and List Follow-Up the lists used and untouched.
---

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
