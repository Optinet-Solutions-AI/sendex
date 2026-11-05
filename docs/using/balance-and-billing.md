# Balance and billing

Your organisation pays for messages from a prepaid balance. The balance is shown at the top
of every page (**Balance: EUR 4,988.31**); click it to open **Billing**. Every send is
charged to the balance as it goes out, and the campaign estimate tells you what a send will
cost before you press **Send**.

## Fund your account

Card and PayPal payments arrive in stage two; today an **owner** records a payment that has
reached the platform by bank wire or crypto, or a manual adjustment:

1. Open **Billing** and find **Fund your account** on the right.
2. Enter the **Amount (EUR)**, pick the **Method** (bank wire, crypto, manual adjustment),
   type the payment **Reference** (the bank or transaction reference) and an optional
   **Note**.
3. Click **Record deposit**. The balance in the header updates straight away and the deposit
   appears at the top of the **Deposits** tab.

The reference must be unique: a payment that was already recorded is refused with "A deposit
with reference … has already been recorded", so a double click or a second person entering
the same wire cannot credit the account twice. Recording a deposit requires a recent
sign-in; if you have been signed in for a while you are asked for your password again.

## Tabs

| Tab | What it shows |
| --- | --- |
| **Deposits** | Every deposit, newest first: date, amount, method and reference, note. |
| **Transactions** | Every ledger entry: deposits, debits (message charges, shown negative), refunds (for messages the carrier rejected) and adjustments. Filter by **Kind** and a date range, then **Export CSV** to download the filtered list. |
| **Summary** | One row per day with deposits, debits, refunds, adjustments, net movement and the number of entries, plus a **Spend by campaign** table for the same range. The default range is the last thirty days; change **From** / **To** and click **Apply**. **Download report CSV** gives the daily table as a file. |

Dates are in UTC. Amounts are in EUR with two decimals; the ledger itself keeps six, so a
message priced at EUR 0.0357 shows as EUR 0.04 in the table and 0.04 in the CSV while the
balance stays exact.

## Low balance alert and daily caps

Owners set these under **Settings → Billing** (or the **Low balance alert and caps** button
on the Billing page):

| Setting | Meaning |
| --- | --- |
| **Alert when the balance drops below (EUR)** | Leave blank to switch the alert off. |
| **Send the alert to** | Up to five email addresses, one per line. |
| **Messages per day** | The organisation cannot send more messages than this in a calendar day. Blank means no cap. |
| **Spend per day (EUR)** | The organisation cannot be charged more than this in a calendar day. Blank means no cap. |

The alert is sent once when the balance first drops below the threshold. It is not repeated
while the balance stays low; once a deposit brings the balance back to the threshold or
above, the alert arms again and fires on the next dip. The settings page tells you when the
last alert went out. The caps are enforced by the sending engine when it schedules laps.

## Audit log

Owners see **Audit log** in the left menu: who did what and when, including every deposit
(`balance.deposit`) and settings change (`settings.update`), list uploads and flushes, and
campaign sends. Filter by action, actor and date, and **Export CSV** for your records.
