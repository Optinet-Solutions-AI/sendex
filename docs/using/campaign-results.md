# Campaign results

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
