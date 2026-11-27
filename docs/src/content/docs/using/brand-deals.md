---
title: Brand deals
description: What each brand pays per first deposit, kept per Scaleo offer; offers earn their deal by themselves.
---

Revenue in Sendex comes only from the deals we have with brands, as recorded in Media Deals. Each **first deposit** earns the **CPA** of its offer's deal, at the price in force on the day of the deposit. The amount a tracker sends with a deposit postback (Scaleo's `value`, for example) is kept in the Postback Logs as **Tracker amount**, but it is not revenue.

Open **Settings → Brand deals**. Everyone can see the page; adding deals and choosing them needs the right to manage settings.

## Deals are kept per Scaleo offer

Each deal belongs to the **Scaleo offer** the brand is sold through: the number after `o=` in the offer link (for example `…/click?o=1234&a=42…` is Scaleo offer 1234). Every Sendex offer whose link points to that Scaleo offer **earns the deal by itself**, including offers added later: nothing to choose by hand.

The deals were first imported from the Scaleo offer sheet of Danny's Media Deals file (27 November 2026, prices from 1 November).

## Add a deal, or change a price

Under **Add or change a deal**, fill in:

| Field | Example | Notes |
| --- | --- | --- |
| **Program** | Example Partners | The affiliate program. |
| **Brand** | Brand A SMS | As named in Scaleo. |
| **Scaleo offer id** | 78 | The number after `o=` in the offer link. Leave empty for a brand not sold through Scaleo; then choose the deal on the offer below. |
| **CPA (€)** | 150 | What the brand pays per first deposit, in euros. Rev share and baseline are not counted. |
| **From** | 2026-11-01 | The day the price starts. |

Click **Save deal**. To change a price, save the same Scaleo offer again with the new CPA and the day it starts: deposits before that day keep the old price.

## Offers

Under **Offers**, each offer shows the deal it earns from. An offer without one shows an amber "No revenue" badge; choose its deal from the list if its link is not a Scaleo link.

## What changes after a save

Sendex works out all past first deposits of the organisation again: each earns the CPA of its offer's deal in force on the day it came, or nothing. Campaign results, the Dashboard, Performance and list details all show that revenue; profit is revenue minus cost. Repeat deposits and registrations earn nothing.
