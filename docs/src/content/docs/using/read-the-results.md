---
title: Read the results
description: What each column on the results page means and how to use them to rank routes and campaigns.
---

The results page shows one row per campaign, and inside a campaign one row per route, so you can compare like with like. Counts come from carrier delivery receipts, clicks from the short-link service, and leads and sales from postbacks your landing page sends back to Sendex.

## Columns

| Column        | Meaning                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------- |
| **Sent**      | Messages accepted by the carrier. Not the same as delivered.                                      |
| **Delivered** | Messages the carrier reported as delivered to the handset.                                        |
| **Failed**    | Messages the carrier reported as failed or expired. Sent minus delivered minus failed is pending. |
| **Clicks**    | Unique recipients who opened the short link. Repeat clicks by the same recipient count once.      |
| **CTR**       | Clicks divided by delivered, as a percentage.                                                     |
| **Cost**      | Total debited for the row: price per SMS times parts, refunds already deducted.                   |
| **CPC**       | Cost per click: cost divided by clicks.                                                           |
| **Leads**     | Registrations reported by postback (one per click id).                                            |
| **CPL**       | Cost per lead: cost divided by leads.                                                             |
| **Sales**     | Sales reported by postback, with their total value where the postback carries one.                |
| **CPS**       | Cost per sale: cost divided by sales.                                                             |
| **Rank**      | Position of the row among its siblings, by CPS when there are sales, else CPL, else CPC.          |

## Steps

1. Open **Results** from the sidebar, or the **Results** tab inside a campaign. (coming on Day 3)
2. Filter by **date range** and **country**. Each row's numbers are for the chosen range.
3. Expand a campaign to see its **routes**. This is the view to use when deciding where to [Finish List](/using/send-and-scale/).
4. Sort by any column. **Rank** is the default and already encodes "cheapest proven outcome first".
5. Export to CSV if you need the numbers elsewhere.

## Reading the numbers honestly

- Judge a route on **delivered**, not sent. A route can accept everything and deliver half.
- Give clicks and postbacks time. CTR is reliable after a few hours, leads and sales after a day.
- A route with no sales yet ranks by CPL, which can flatter it. Look at the sample size next to each row before trusting a rank based on a handful of events.
- Pending messages (sent but neither delivered nor failed) are excluded from CTR so a slow carrier does not look worse than it is.
