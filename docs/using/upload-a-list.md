# Upload a list

Lists hold the phone numbers a campaign sends to. One list is for one country; upload a
separate list per country, as in SMS Edge. You need the `campaign_manager` or `owner` role.

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

## Settings

| Setting | Meaning |
| --- | --- |
| **List** | **+ New List** creates a list with the name and country you give; picking a list adds the numbers to it, and it keeps its country. |
| **New List Name** | Up to 100 characters, proposed from the file name. The convention is `Client_COUNTRY_date_batch`, e.g. `Roy Boy_ES_14092026_Batch2`. |
| **Fixed Country** | The list's country. Numbers without a country code (`612 345 678`) are read for the row's **Country** cell when there is one, else for this country; numbers with one (`+34…`, `0034…`) keep theirs. **Auto-detect from file** uses the most common value of the Country column and needs one. |
| **Logical Check** (on by default) | Premium-rate, shared-cost and toll-free numbers are rejected; landlines and suspicious digit patterns are kept but marked Bad and never sent to. Invalid and unparseable numbers are always rejected. |
| **Duplicates** | **Allow duplicates** (default): a number the organisation already has is added to this list as well. **Skip numbers already in my contacts**: a number already uploaded, in any list, is not added again. A number is never added to the same list twice. |
| **Flush after import** | Numbers you have sent to before stay blocked even in a new list; this resets the *sent* flag of every number in the list so all of them are available to the next campaign. |

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
