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

## AutoSender

Switch **Run AutoSender** on under **Advanced Settings** before the first send and Sendex
runs the test-and-scale loop for you:

1. Your send is the **test round**: one lap of the test size per route you ticked.
2. AutoSender waits until every test lap is done **and** the **measure window** has passed
   (60 minutes from the start of the round by default), so clicks have time to arrive.
3. The best lap wins: highest CTR, then lowest cost per click. If no test lap got a click,
   AutoSender stops and tells you why.
4. It queues one **scale-out lap** per list on the winning route, each of **scale factor ×
   test size** messages (5 × by default), capped by what is left on the list. Scale-out laps
   are flagged in the lap table and in the Logs tab as `autosender.scale`.
5. After each scale-out lap finishes it checks the lap's CTR against the **CTR floor** (80 %
   of the test CTR by default). While the CTR holds and contacts remain, it queues the next
   lap; when the CTR drops below the floor or the lists are finished, it stops
   (`autosender.stop`, with the reason shown under Advanced Settings).

The three knobs (measure window, scale factor, CTR floor) are per campaign and editable while
AutoSender is on. Pausing or stopping the campaign pauses AutoSender with it; switching
AutoSender off and on again after it stopped starts a fresh judgement of the laps so far.
Every lap it creates is charged like any other: per message, as it sends.
