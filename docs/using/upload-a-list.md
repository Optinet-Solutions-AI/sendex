# Upload a list

Lists hold the phone numbers a campaign sends to. One list is for one country; upload a
separate list per country, as in SMS Edge. You need the `campaign_manager` or `owner` role.

## Steps

1. Open **Lists** in the left menu and click **Upload List**.
2. Give the page your numbers, either way:
   - **Drop a file** on the dashed box, or click **Choose file**. CSV and TXT files up to
     10 MB are accepted; the delimiter (comma, semicolon, tab) is detected automatically.
   - **Paste** numbers into the box, one per line, and click **Use pasted data**.
3. Check the **Columns** preview. The first ten rows are shown. Above each column a picker says
   what the column is: **Phone**, **First name**, **Last name**, **Email**, **Custom 1 to 5**
   or **Ignore**. The phone column is detected automatically (the column where most values
   look like phone numbers) and the others are guessed from the header row. Exactly one
   column must be **Phone**. Tick **First row is a header** if the first line holds column
   names rather than data; the page guesses this too.
4. Fill in the **Settings** (below).
5. Click **Import**. Large files are sent in chunks of 5,000 rows with a progress bar; a
   100,000-row file takes a minute or so.
6. Read the **summary**: rows read, imported, skipped, duplicates and dropped numbers by
   reason. Click **View list** to open the list or **Back to lists** to return to the table.

## Settings

| Setting | Meaning |
| --- | --- |
| **New list** / **Existing list** | Create a list with the name and country you give, or add the numbers to a list you already have. An existing list keeps its country. |
| **List name** | Up to 100 characters. The convention is `Client_COUNTRY_date_batch`, e.g. `Roy Boy_ES_14092026_Batch2`. |
| **Country** | The country the numbers belong to. Numbers without a country code (`612 345 678`) are read as numbers of this country; numbers with one (`+34…`, `0034…`) keep theirs. |
| **Logical check** (on by default) | Drops numbers that cannot receive marketing SMS: landlines, premium-rate, shared-cost and toll-free numbers. Mobiles and numbers that may be mobiles are kept. Switch it off only when you know the list holds mobiles that the check misreads. Invalid and unparseable numbers are always dropped. |
| **Duplicates** | **Skip numbers already in my contacts** (default): a number the organisation has already uploaded, in any list, is not added again. **Allow**: the number is added to this list as well. A number is never added to the same list twice. |
| **Flush after import** | Once the rows are in, resets the *sent* flag of every number in the list so all of them are available to the next campaign, including numbers that were sent before. |

## What the summary means

- **Rows read**: lines in the file, after blank lines are removed.
- **Imported**: numbers added to the list.
- **Skipped**: numbers not added because the organisation already had them (with *Skip*) or
  because they were already in this list.
- **Duplicates in file**: the same number appearing more than once in the upload; the first
  copy is kept.
- **Dropped by reason**: *Landline*, *Invalid* (not a real number for its country), *Unparseable*
  (not a number at all), *No country* (no country code and none could be assumed), *Premium rate*,
  *Toll free*.

Every upload is recorded in the audit log with these counts and the settings used. Phone
numbers themselves are never written to logs.

## Flushing a list

A campaign marks each number it sends to as *sent*; the next campaign on the same list skips
them. **Flush** (from the **⋯** menu on a row, or the button on the list page) clears those
marks so every number is available again. **Flush All Lists** does it for every list in the
organisation. Both ask for confirmation. Numbers marked *bad* (rejected by a carrier) stay bad.

## Exporting the table

**Export CSV** on the Lists page downloads the table as you see it, with the current search,
country filter and sort order.
