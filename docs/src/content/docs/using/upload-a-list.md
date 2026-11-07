---
title: Upload a list
description: Import a CSV of phone numbers into a country list, map its columns and let Sendex check the numbers.
---

A list is a set of phone numbers for one country. Campaigns pick one or more lists, so keep lists narrow (one source, one country) and name them so you can tell them apart later.

## What a list needs

- **Country.** Every list belongs to exactly one country. Numbers are normalised to E.164 for that country, and a campaign can only use lists from its own country.
- **A CSV file.** One row per contact. The phone column is required; any other columns (name, city, custom fields) are optional.
- **Column mapping.** Sendex guesses which column holds the phone number and lets you confirm or change it before anything is imported.
- **Logical check.** Each number is parsed for the list country. Rows that do not parse, that are the wrong length for the country, or that duplicate an earlier row are counted and left out, and you see the counts before the import is committed.

## Steps

1. Open **Lists** and choose **Upload list**. (coming on Day 1)
2. Pick the **country** the list belongs to.
3. Give the list a **name** such as `IT sports leads March`.
4. Choose the **CSV file**. Any delimiter among comma, semicolon and tab is detected.
5. Map the columns: confirm the **phone** column and optionally map extra columns you want to keep for personalisation.
6. Review the **logical check**: total rows, valid numbers, invalid numbers, duplicates removed. Download the rejected rows if you want to fix and re-upload them.
7. Confirm the import. The list appears with its final count and is ready to use in a campaign.

## Tips

- Upload large files once rather than many small ones; a campaign can combine several lists anyway.
- Re-uploading the same file to the same list skips numbers already in it.
- Lists are scoped to your organisation; nobody outside it can see or use them.

## The Lists table

**Contacts › Lists** shows every live list with Name, Numbers, Countries, Sent, CTR, Leads,
Sales, Spend (what the campaign engine sent to the list and what it cost, across every lap),
Last Sent, Last Upload and Created, 25 per page ("1 of 6", Previous and Next). Search by
name, pick one or more countries in the **Countries** multi-select, and sort by any column.

- The **…** menu on a row opens **View**, **Flush**, **Archive** (hides the list from the
  table and from the campaign pickers; its numbers stay, and **Show archived** brings it
  back with **Unarchive**) and **Delete**.
- Tick rows (or the header box for the whole page) to get the bar "n lists selected ·
  Clear selection · Delete selected". Deleting a list removes its memberships for good;
  the contacts themselves stay in your organisation. Only an owner can delete lists.
- **Export CSV** downloads the table with the current filters.
