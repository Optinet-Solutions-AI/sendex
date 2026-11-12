---
title: The campaigns list
description: The columns, filters, CSV export and actions of the Campaigns table.
---

**Campaigns** in the left menu lists every campaign of your organisation, newest first, 25 per
page, with the totals of its laps.

## Columns

| Column | Meaning |
| --- | --- |
| **ID** | The first block of the campaign's id; hover for the full id. |
| **Campaign** | The name; click it to open the campaign. |
| **Status** | `draft`, `scheduled`, `sending`, `paused`, `stopped` or `completed`. |
| **Country** | The flag and country code the campaign sends to. |
| **Laps** | How many laps (list × route sends) the campaign has queued or run. |
| **Sent** | Messages the carrier accepted, over all laps. |
| **Clicks** | Clicks on the tracked link. |
| **CTR** | Clicks divided by sent. |
| **Cost** | What the campaign has debited from your balance. |
| **Leads** / **Sales** | Conversions reported by your tracker's postbacks. |
| **Period** | When the first lap started and the last one finished, in the campaign's timezone. "–" for a campaign that has not sent. |
| **Actions** | A menu with **View**, **Duplicate** and **Delete**. |

## Sorting

Click a column header to sort by it: Campaign, Status, Country, Laps, Sent, Clicks, CTR, Cost,
Leads, Sales or Period. Click it again to reverse the order. Names, statuses and countries sort A
to Z first; numbers and the period sort largest or newest first. The sorted column shows ↓ or ↑
and the others ↕. Without a sort the newest campaign is on top. The sort is kept in the page
address with the filters, applies to **Export CSV** too, and sends you back to page 1.

## Filters

Type in **Search** and press Enter to search by name. **Filters** opens the filter row below it;
press **Apply** there to apply, **Clear** to reset.

- **Search**: part of the name, case-insensitive.
- **Countries** (a searchable multi-select: tick as many as you like; All countries clears it) and **Status**.
- **Date Range**: Today, Yesterday, Last 7 / 14 / 30 / 90 Days, or your own From and To days.
- **From** / **To**: keep campaigns whose sending period overlaps the days you pick (both days
  included). A campaign that has not sent yet is placed at the day it was created.
- **Has leads**, **Has sales**: only campaigns with at least one lead / sale.
- **No clicks**: only campaigns with no click yet (drafts included).
- **Spend above** / **below**: cost bounds in EUR, both inclusive.

The filters live in the page address, so a filtered view can be bookmarked or shared.

## Export CSV

**Export CSV** (next to Filters, always visible) downloads every campaign that matches the current filters, not just the page on
screen, with the same columns as the table (cost in EUR with two decimals, the period as two
ISO timestamps). The file is named `campaigns-<date>.csv`.

## Actions

- **View** opens the campaign page.
- **Duplicate** creates a new draft called "Copy of …" with the same lists, sender id group,
  ad texts, tracked links, test size and contact-reuse setting, and opens it. Routes are picked
  again in the send form, and nothing is sent until you press **Send**.
- **Delete** removes a campaign that is still a draft. Campaigns that have sent cannot be
  deleted, so their history stays on the books.

Duplicating and deleting are recorded in the campaign's **Logs** tab and in the audit log.
