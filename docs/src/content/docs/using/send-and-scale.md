---
title: Send and scale
description: Send a test batch of N messages per route, compare the routes, then finish the list on the best one.
---

Sendex never sends a whole list in one go. You start with a **test batch** of a fixed number of messages on each route available for the campaign country, wait for delivery receipts and clicks, and then **Finish List** on the route (or routes) that performed. This is how you avoid paying for a route that looks cheap but delivers badly in that country.

## Why routes differ

Each route is a carrier connection with its own price per SMS for the country, its own delivery rate, and its own rules about sender IDs. Delivered and click rates can differ by a lot between two routes for the same list, so the test batch is the only reliable way to pick.

## Steps

1. Open the campaign and go to **Send**. (coming on Day 2)
2. Choose the **batch size** `N` (for example 500). Sendex takes the next `N` unsent numbers for each route you tick, so three routes at `N = 500` sends 1,500 test messages in total.
3. Tick the **routes** to test. Each shows its price per SMS and the estimated cost of its batch; the total is checked against your balance before anything is queued.
4. Start the batch. Progress updates per route as messages are accepted by the carrier.
5. Wait for results. Delivery receipts arrive within minutes; clicks take longer, so give it at least an hour before judging.
6. Compare the routes in the campaign's results table: delivered rate, CTR, cost per click.
7. Choose **Finish List** on the winning route to send the remainder of the campaign through it. You can split the remainder across more than one route if two performed equally well.

## Costs and balance

- Every message debits your balance at the route's price times the number of parts, at the moment it is queued. The debit and the send are recorded together, so a message that is never submitted is never charged.
- Failed messages are refunded when the carrier reports the failure as not billable.
- If the balance would go below zero, the batch does not start; top up first.
