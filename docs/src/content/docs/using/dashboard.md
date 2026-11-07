---
title: Dashboard
description: The SMS Dashboard tabs (Getting Started, Overview, ROI, Countries, Contacts, Assets, API Usage) and the global date and country filters.
---

The dashboard is the first page after sign-in. A tab strip picks the view; the **date
range** (All time, 30d, 90d, Custom) and **Countries** filters on the right apply to every
tab and live in the URL (`?tab=overview&range=30d&country=ES`), so a view can be bookmarked
or shared. The header keeps **Upload Contacts** and **+ New Campaign**.

Every figure is read live from the message, click, postback and ledger rows: "sent" is a
message the carrier accepted, "spend" is the ledger debit of those messages, and leads and
sales are the postbacks matched to them. Nothing is cached overnight.

## Getting Started

Four tiles (Contacts on file, Messages sent, Spend, Sales), the **Start here** strip with
the balance and **Top up**, the **Common actions** cards (upload, create a campaign, test
your SMS, platform routes, add balance), **Go further** (API, OTP, docs) and **Need a hand?**.

## Overview

The four tiles plus **Blended cost / sale** (spend over sales), then two charts: **Contacts
uploaded per country — over time** and **SMS sent per country — over time** with a
**Month / Week** toggle. Both stack the top eight countries and fold the rest into Other.
Hover a bar for every country's value; **Table** on any chart shows the same numbers as a
table.

## ROI

The **ROI pivot** nests cost, clicks, leads, sales and the derived metrics by the row
dimensions you keep as chips (Country, Link, List; **+ Group** and **+ Date** add one, ✕
removes one). **Metrics (n)** ticks the columns: Cost, Clicks, Leads, Sales, CPC, CPL, CPS,
Profit and ROI by default, plus CtL, CtS and LtS. Click a column to sort, › to drill down,
**Expand** / **Collapse** for everything, **CSV** to download the expanded table. Negative
profit and ROI are red; "—" means not computable. A bold **Grand Total** closes the table.

Revenue is the sale value your tracker reports or, when it reports none, the offer's
**profit per sale**; profit is revenue minus cost and ROI is profit over cost.

Under it, **Cost per sale — accumulated over time** draws the cumulative (dashed green) and
monthly (navy) cost per sale, account-wide.

## Countries

- **Utilisation map**: one dot per country, x = contacts on file, y = sends ÷ contacts with
  a dashed line at 100%, coloured by cost per FTD (grey = no sales).
- **Unique signups** and **Unique buyers — accumulated over time**: stacked by country; a
  contact counts once, in the month of its first lead or sale.
- The **per-country table**: contacts, sent, CTR, utilisation, signups, sales, cost per
  sale, last sent and a status badge: **Healthy** from 50% utilisation, **Under-worked**
  below.
- Two insight cards: **Biggest opportunity — unused pool** and **Review economics**.

## Contacts

- **Lists** (10 a page, by size) and **Segments** (with the rule summary and when a campaign
  last used them).
- **Contacts on file vs messages sent** per country.
- **Send-count distribution by country**: good (sendable: in a list, not bad, not
  unsubscribed) contacts in the buckets 0, 1–2, 3–5, 6–10 and 11+ messages received, stacked
  by country, with a dot for the CTR of the messages sent to each bucket on the top axis.
- **Good contacts we're not sending to**: per country, good contacts and how many were sent
  fewer than the number in the **Sent fewer than [n] times** box; change the number and the
  table recalculates.

## Assets

Three tables with their own search box: **SMS Texts**, **Offers** and **Sender IDs**
performance, ranked by sent, with delivered rate, clicks, CTR, CPC, signups, sales, cost
per sale, spend and last sent. Offers group the campaigns that used the same link; a sender
id shows its group's country underneath.

## API Usage

Campaigns created through the public API: a KPI strip (messages sent, previews, clicks,
CTR, spend), **API messages per country — over time**, the **Target Countries** table with
a Total row and the **API SMS send log** (from, to, country, text, cost, status, date).
Without any, the tab says **No API traffic**. **API Documentation** opens the worker's
reference.
