# Create a campaign

A campaign sends one or more ad texts, from a pool of sender ids, to one or more lists of one
country, through the routes you pick. Sending happens in *laps*: one lap per list and route,
each sending the test size first so the routes can be ranked before the rest of the list goes
out through the best one.

## 1. New Campaign

1. Open **Campaigns** in the left menu. The table shows every campaign of your organisation
   with its status, country, laps, sent, clicks, CTR, cost, leads, sales and period. Use the
   search box and the filters to narrow it down; **Export CSV** downloads every row that
   matches (see [The campaigns list](campaigns-list.md)).
2. Click **New Campaign**.
3. Enter a **Name** (up to 120 characters), pick the **Country** and check the **Timezone**.
   The timezone is filled in from the country (Spain gives `Europe/Madrid`) and is what the
   start time and the reports use; change it only if the campaign is run from elsewhere.
4. Click **Create campaign**. You land on the campaign page.

## 2. The campaign page

The header shows the name, status, country and creation date, the totals over all laps
(sent, clicks, CTR, leads, sales, cost, cost per lead, cost per sale) and the sending
progress bar. Below it are four tabs: **Status** (the send form), **Logs** (who did what),
**Analytics** and **Send Single** (both arrive in a later card).

The **Status** tab has the form on the left, a live **Summary** panel on the right (with its
own Lists / Links / Ad Texts / SIDs / Routes tabs) and a footer that recalculates
CONTACTS, SIDS, TEXTS, LINKS, TEST SIZE, SMS and COST after every change.

### Schedule

Leave **Send Now** on, or switch it off and enter a **Start time**. The time is entered in
the campaign's local time; the note under the field says which zone it is sent in.

### SIDs

Pick a **sender id group** for the campaign's country. The campaign rotates through the
group's active sender ids. **New group** creates an empty group for this country and selects
it; **Add SIDs** adds sender ids to the selected group, one per line or comma separated,
3 to 11 letters or digits. Duplicates already in the group are skipped and reported. Switch
individual sender ids off with their toggles.

### Lists

Tick the lists to send to. Only lists of the campaign's country are offered. Each shows how
many numbers are *left*: members that are not bad, not flushed, not suppressed and not yet
sent to.

### Links

The tracked destinations (SMS Edge calls them Offers). Attach an existing link or add a new
one with a **Name** and a **URL**; click the placeholder chips (`{{dynamic}}`, `{{geo}}`,
`{{custom1}}` ... ) to append them to the URL. Each attached link has an on/off switch and
can be removed from the campaign.

### Ad Texts

Click **Add Texts**. Type the message; click a chip to insert a placeholder (`{{domain}}`
for the tracked link, `{{first_name}}`, `{{opt_out}}`, or `{word1|word2}` to randomise
words). The counter under the box shows, per text, the encoding (GSM-7 or UCS-2), the
character count, the number of SMS parts and how many characters are left before another
part is needed. One accented or special character outside the GSM alphabet switches the
whole text to UCS-2 and halves the capacity, so watch the counter.

To add several texts at once, separate them with a line containing only `//`.

**Check `{{domain}}` exists** is on by default and blocks saving while a text has no
`{{domain}}`; switch it off only for texts that deliberately carry no link.

Saved texts appear in the table with a preview, their encoding, their parts, an on/off
switch and **Edit**.

### Routes

Tick one or more routes. Each shows its current price per SMS for the campaign's country.
Routes without a price for the country cannot be selected.

### Advanced Settings

- **Test size**: numbers sent per list and route in the first laps (default 200).
- **Contact reuse**: whether to skip numbers already messaged by *any* campaign of the
  account, or only by *this* campaign.
- **Send all**: send every number left on the lists, split evenly across the picked routes,
  instead of a test slice.

## 3. Check the footer and send

The footer gives the final numbers: with one list, two routes and a test size of 200 it
reads SMS 400 and the cost at each route's price. Press **Send**. The laps are queued and
listed under the form (lap id, route, list, size, sent, clicks, CTR, cost, CPC, leads, CPL,
sales, CPS, rank and period); the campaign's status becomes *sending*, or *scheduled* when a
start time is set. The sending engine picks the queued laps up from there.

## Duplicate and delete

In the campaigns table, **Duplicate** creates a draft "Copy of ..." with the same lists,
sender id group, texts, links and settings, ready to send again. **Delete** removes a
campaign and is only available while it is still a draft. Both are recorded in the Logs tab.
