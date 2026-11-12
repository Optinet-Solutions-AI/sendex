---
title: Campaign results
description: What the header totals, the lap table, the on/off switch and the Analytics tab of a campaign mean.
---

Open a campaign from the **Campaigns** table (or straight after sending it) to see how it is
doing. The page has three parts: the totals in the header, the lap table under the send form
on the **Status** tab, and the **Analytics** tab.

Every number on this page comes from the same rows the worker writes while it sends: a lap's
counters are moved as messages are submitted, delivery receipts arrive, links are clicked and
postbacks come in. The Analytics breakdowns are counted again from the individual messages and
clicks, so the two always agree.

## The header

| Tile | Meaning |
| --- | --- |
| **Sent** | Messages the carrier accepted, across every lap. |
| **Delivered** | Messages with a delivery receipt saying the handset got them. |
| **Failed** | Messages the carrier rejected or could not deliver (including expired ones). |
| **Clicks** | Clicks on the tracked link, all laps together. |
| **CTR** | Clicks divided by sent, as a percentage. |
| **Cost** | What the campaign has debited from your balance so far. |
| **CPC** | Cost per click. Shown as "–" until there is a click. |
| **Leads** | Registrations reported by your tracker's postbacks. |
| **CPL** | Cost per lead; "–" until there is a lead. |
| **Sales** | Deposits / sales reported by postbacks. |
| **CPS** | Cost per sale; "–" until there is a sale. |

The **Sending progress** bar compares the messages sent with the contacts the laps were asked
to send to.

## The lap table

One row per lap, that is per list and route of one send. Above the table sits the laps
header: the campaign's country with its local time, a "n laps" pill, the budget top-ups
(**Custom** and **+ €5 €10 €20 €50 €100 €200**), **Finish List**, and the **Sort by rank** and
**Show comments** switches. The columns are the SMS Edge ones, plus Delivered and Failed:

| Column | Meaning |
| --- | --- |
| **Lap ID** | The first block of the lap's id; hover for the full id. |
| **Route** | Which route carried the lap and its price per SMS, "Route 405 (€0.0250)". |
| **List** | The list it drew from; the link opens List Details in a new tab. |
| **Sent, Delivered, Failed, Delivery** | As in the header, for this lap only. |
| **Previews** | Link-preview bots (messaging apps fetching the page) that hit the lap's links. Never counted as clicks. |
| **Clicks, CTR, Cost, CPC, Leads, CPL, Sales, CPS** | As in the header, for this lap only. |
| **Rank** | 1 is the best route of the test round (highest CTR, then lowest cost per click, then most sent). Empty until the laps are done. |
| **Sending Period** | When the lap started and finished, in the campaign's timezone. |
| **On** | The lap's switch, see below. The switch in the heading flips every lap at once. |
| **ⓘ** | Status, size, budget top-ups, a scheduled start and anything a daily cap refused. |
| **⋮** | Reschedule, Flush lap, Add comment. |

Click a column heading to sort by it; click again to flip the direction. The table opens
sorted by **Rank**, so the best route is on top; laps without a rank sort last. Switching
**Sort by rank** off shows the laps in the order they were created.

### Budget top-ups

A top-up adds the amount to every lap that is switched on. Each lap then sends `amount ÷ (its
route price × SMS parts per message)` more messages (€50 on a €0.025 route is 2,000 more SMS,
or 1,000 when the campaign's longest active text is two parts), so a lap never spends more than
the amount; a finished lap goes back in the queue to send them. Hover a button for the maths: "3 active sends × €50 = €150 · New SMS
sent: ~6,000 · Will spend an additional €50 per each highlighted lap". The top-up is refused
when your balance cannot cover amount × laps. Nothing is charged up front: messages debit the
balance as they are sent, exactly like a test batch. **Custom** takes any amount.

### Finish List

Sends everything left on the campaign's lists through the routes of the laps that are on,
as one lap per list and route. Use it once the test round has shown which route wins and the
losing laps are switched off.

### Switching a lap off and on

The **On** switch at the end of each row excludes a lap from further sending:

- Switching a `queued` or `sending` lap **off** cancels it. Messages that were queued but not
  yet handed to the carrier are cancelled and refunded to your balance; messages already
  submitted are left as they are. The lap's status becomes `cancelled`.
- Switching a `cancelled` lap **on** puts it back in the queue; the worker continues where it
  stopped, skipping contacts it has already messaged.
- A `done` lap has nothing left to send, so its switch is disabled.

### The lap menu

- **Reschedule** holds a queued lap until the time you pick (in the campaign's timezone); the
  worker leaves it alone until then.
- **Flush lap** resets the sending progress of the lap's list, so the same contacts can be
  sent to again by any campaign. It asks first.
- **Add comment** keeps a note on the lap; switch **Show comments** on to read them under the
  rows.

Every flip, top-up, reschedule, flush and comment is written to the **Logs** tab
(`lap.toggle`, `lap.topup`, `lap.reschedule`, `lap.flush`, `lap.comment`), together with the
cancellation the worker records. Only users who may send campaigns can use the switches and
top-ups; flushing needs the list flush permission.

## Analytics

- **Networks**: one row per route and provider, counted from the messages themselves: sent,
  delivered, delivery rate, failed, clicks, CTR and cost. Sendex does not yet record the mobile
  operator of a number; when delivery receipts start to carry it, this table will break down
  by operator instead.
- **Clicks per hour since the first send**: hour 0 starts at the first message sent; each bar
  is one hour with the number of clicks in it. Hours without a click are not listed.
- **Clicks per link**: for each tracked link attached to the campaign (and "No link" for
  messages that carried none), how many messages went out with it, how many were clicked and
  the CTR.
- **Conversions**: leads and sales per sender id and per ad text; see
  [Track conversions](/using/track-conversions/). Under the Leads and Sales totals, "3 same
  day · 1 late" says how many came on the UTC day their SMS was sent and how many on a later
  day ([Same-day and late conversions](/using/reports/#same-day-and-late-conversions)).

## Checking a number

The page is designed to match a direct count. For one campaign, the header's **Sent** equals
`sum(sent)` over its laps, the **Networks** table's **Sent** for a route equals the number of
its messages in status `sent`, `delivered` or `expired`, and the clicks in every breakdown add
up to the number of rows in the clicks table for that campaign.
