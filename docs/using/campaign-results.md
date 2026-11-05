# Campaign results

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

One row per lap, that is per list and route of one send. The columns are the SMS Edge ones:

| Column | Meaning |
| --- | --- |
| **Lap ID** | The first block of the lap's id; hover for the full id. |
| **Route** / **List** | Which route carried the lap and which list it drew from. |
| **Status** | `queued` (waiting for the worker), `sending`, `done`, or `cancelled`. |
| **Size** | How many contacts the lap was asked to send to (the test size, or the whole list). |
| **Sent, Delivered, Failed, Clicks, CTR** | As in the header, for this lap only. |
| **Cost**, **CPC**, **Leads**, **CPL**, **Sales**, **CPS** | As in the header, for this lap only. |
| **Rank** | 1 is the best route of the test round (highest CTR, then lowest cost per click, then most sent). Empty until the laps are done. |
| **Period** | When the lap started and finished, in the campaign's timezone. |
| **On** | The lap's switch, see below. |

Click a column heading to sort by it; click again to flip the direction. The table opens
sorted by **Rank**, so the best route is on top. Laps without a rank sort last.

### Switching a lap off and on

The **On** switch at the end of each row excludes a lap from further sending:

- Switching a `queued` or `sending` lap **off** cancels it. Messages that were queued but not
  yet handed to the carrier are cancelled and refunded to your balance; messages already
  submitted are left as they are. The lap's status becomes `cancelled`.
- Switching a `cancelled` lap **on** puts it back in the queue; the worker continues where it
  stopped, skipping contacts it has already messaged.
- A `done` lap has nothing left to send, so its switch is disabled.

Every flip is written to the **Logs** tab as `lap.toggle`, together with the cancellation the
worker records. Only users who may send campaigns can use the switch.

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
  [Track conversions](track-conversions.md).

## Checking a number

The page is designed to match a direct count. For one campaign, the header's **Sent** equals
`sum(sent)` over its laps, the **Networks** table's **Sent** for a route equals the number of
its messages in status `sent`, `delivered` or `expired`, and the clicks in every breakdown add
up to the number of rows in the clicks table for that campaign.
What the numbers on a campaign page mean: the header, the lap table under the send form and
the Clicks section of the Analytics tab all use the same definitions.

## Sent, delivered, failed

| Column | Meaning |
| --- | --- |
| **Sent** | Messages the carrier accepted. It moves while the campaign sends and never changes afterwards. Not the same as delivered. |
| **Delivered** | Messages the carrier reported as delivered to the handset, through a delivery receipt. Receipts usually arrive within seconds, sometimes hours later for phones that are off. |
| **Failed** | Messages that will not be delivered: rejected by the carrier when sent, reported undelivered or expired by the carrier, or still without a receipt 24 hours after sending (those show the error code `NO_RECEIPT`). |
| **Delivery** | Delivered divided by sent, as a percentage. 95 delivered of 100 sent is 95.00%. |

Sent minus delivered minus failed is what is still pending. A message's status never goes
backwards: once delivered it stays delivered even if a later receipt says otherwise, and a
message that expired is not revived by a receipt arriving after 24 hours.

A failed delivery is not refunded: the carrier charged for the attempt. A message the carrier
rejected at send time is refunded, since it was never sent.

## Clicks, CTR, CPC

| Column | Meaning |
| --- | --- |
| **Clicks** | Recipients who opened the short link. A recipient counts once however many times they open it; link previewers and bots are not counted at all. |
| **CTR** | Clicks divided by sent, as a percentage. 127 clicks on 2,394 sent is 5.30%. |
| **CPC** | Cost divided by clicks. Shown as "–" until there is a click. |
| **All redirects** | (Analytics tab only) every opening of the link, repeat openings included. |

CTR is measured against sent, not delivered, so a route that accepts everything and delivers
half of it shows the low CTR it deserves. Use **Delivery** to tell a delivery problem from a
creative problem.

## Per route, sender id, ad text and link

The Analytics tab breaks clicks down four ways:

- **By route**: one row per lap. The same numbers as the lap table.
- **By sender id**: every message sent from that sender id, across laps. Cost is the lap cost
  spread evenly over the lap's messages.
- **By ad text**: every message rendered from that text. "No ad text" collects messages sent
  before texts were tracked.
- **By link**: every message carrying that link. "No link" collects messages without one.

These tables refresh every time the page loads, so you can compare sender ids and texts while
the campaign is still sending. Give receipts a few minutes and clicks a few hours before
drawing conclusions; leads and sales (the Conversions section below it) take longer, see
[Track conversions](./track-conversions.md).
