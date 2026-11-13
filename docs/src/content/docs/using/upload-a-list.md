---
title: Upload a list
description: Import a CSV of phone numbers into a country list, map its columns and let Sendex check the numbers.
---

A list is a set of phone numbers for one country. Campaigns pick one or more lists, so keep lists narrow (one source, one country) and name them so you can tell them apart later.

## What a list needs

- **Country.** Every list belongs to exactly one country. Numbers are normalised to E.164 for that country, and a campaign can only use lists from its own country.
- **A file or pasted numbers.** CSV, TXT, XLS or XLSX (up to 10 MB each, several at once), or
  numbers pasted one per line. One row per contact. The phone column is required; any other
  columns (name, city, custom fields) are optional.
- **Field types.** Sendex guesses which column holds the phone number (and the country, name,
  email and other fields) and lets you confirm or change each one before anything is imported.
  A **Country** column lets national numbers (`07400 123456`) be read for their own country.
- **Logical check.** Each number is parsed for the list country. Rows that do not parse or
  are premium or toll-free are **rejected**; landlines and suspicious digit patterns
  (repeated digits, straight runs, long zero tails) are **added as Bad**: they stay in the
  list so you can see them, but are never sent to. Duplicates within the file and numbers
  already in your contacts (with "Skip numbers already in my contacts") are **skipped**.
  Switching the check off keeps landlines as Good members.
- **How a number may be written.** With a plus (`+49 151 5550 1234`), with `00`
  (`0049 151…`), with the country code and no plus (`4915155501234`, the way SMS Edge exports
  write them) or as a local number of the list country (`0151 5550 1234`). All four give the
  same number.
- **Numbers damaged by a spreadsheet.** A spreadsheet program that opens a CSV and saves it
  again can cut long numbers short: `4915161234567` becomes `4.91516E+12` and the missing
  digits are gone. The import step warns you how many numbers in the file look like that, and
  they are **rejected** as "Damaged by a spreadsheet". Upload the original file, or export it
  again with the phone column formatted as text.

## Steps

1. Open **Lists** and click **Upload List**. **Upload Contacts** shows a switch: **Upload
   Files** (drop CSV, TXT, XLS or XLSX files on the dashed box, or click **browse**; several
   at once) or **Paste CSV** (numbers one per line, extra columns after commas, then
   **Upload**).
2. The **Import** page opens, titled after the file, with its rows and size. On the left:
   - **List**: **+ New List** or one of your lists. A new list takes the **New List Name**,
     proposed from the file name (`test-20261107-batch2.csv` becomes `Test 20261107 batch2`).
   - **Fixed Country** (required for a new list): the list's country. **Auto-detect from
     file** takes the most common country of the file's **Country** column; without one, pick
     the country yourself. An existing list keeps its own country.
   - **Logical Check**, **Duplicates** (**Allow duplicates** by default, or **Skip numbers
     already in my contacts**) and **Flush after import**.
   - **File Details**: filename, rows, size, whether the **Number Column** is set, and **First
     row is a header** (guessed for you).
3. On the right, **Field Types** shows the columns as A, B, C with the first rows. Pick a type
   for each column: **Phone Number**, **Country**, **Email**, **Name**, **Last Name**, **Date of
   Birth**, **Gender**, **State**, **Address**, **Custom 1 to 5** or **-- Ignore --**. The
   sparkle marks a type Sendex detected. Each type can be used once, and exactly one column
   must be the phone number.
4. Click **Import** (it stays grey until the phone column and the country are set). Large
   files go in chunks of 5,000 rows with a progress bar; **Cancel** goes back to the start.
5. The summary shows rows read, added (good and bad), rejected and skipped. The file also
   appears on the **Files** page.

## Files

**Contacts › Lists › Files** keeps one row per uploaded file or paste: its ID, name, status,
progress ("4,346 / 4,346" valid rows), the list it went into and when. Expand a row for the
**Import result** (invalid numbers, not mobile, not logical, found in another list,
successfully imported) and the **Duplicates** and sample blocks with the numbers behind each
reason, each with a copy button. Delete removes the record only; the numbers stay in the list.

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

## List details

Click a list name for its page: the KPI tiles (Total numbers, Good, Bad, Cached, Sent,
Clicks, CTR) and five tabs.

- **Contacts**: the numbers, masked to their last four digits, with Country, Status (Good or
  Bad), Cached, Meta and Created; search by number, filter by status, 25 a page.
- **Analytics**: the list grouped by Device Type (the device that clicked) and Country, with
  Audience, Sent, Clicks, CTR, Leads, Sales, Cost and Revenue. Add and remove dimension chips;
  their order sets the grouping.
- **Data Files**: drop a file to add numbers to this list, and the Recent Uploads with their
  import summaries.
- **Campaigns**: the campaigns that sent to this list.
- **Lookup**: the country breakdown (total, good, bad, blacklisted, clickers, sent, clicks).
  HLR and MNP columns fill in once a lookup provider is connected.

**Refresh** reloads the figures; **+ New Campaign** starts a draft campaign in the list's
country with the list already attached.
