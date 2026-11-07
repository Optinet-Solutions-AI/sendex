---
title: Unsubscribe
description: Keep numbers that opted out off every campaign, by hand, by file or through the Unsubscribe API.
---

**Contacts › Unsubscribe** is the account-wide suppression list. A number on it is never
sent to again, in any campaign, from the moment it is added: the send loop checks the list
before every message. Numbers are entered in international format; spaces, dashes and a
leading `+` or `00` are ignored.

## The page

Two figures at the top: **Unsubscribed numbers** (never contacted again on this account)
and **Imported lists** (suppression files you uploaded). Then three tabs:

- **Numbers**: search by number; Number, Country, Source (added by hand, uploaded file,
  Unsubscribe API, STOP reply) and when it was unsubscribed.
- **Imported lists**: one row per uploaded file with how many numbers it added and how
  many rows could not be read.
- **Unsubscribe API**: the two URLs below, each with a Copy button.

## Adding and removing numbers

- **+ Add number**: paste numbers, one per line. Numbers that do not parse are listed in
  the confirmation and left out.
- **Upload unsubscribes**: a CSV, XLS or XLSX. After the upload, pick the column that holds
  the numbers (Sendex guesses the most number-like column), then **Upload**. The file shows
  under Imported lists.
- **Resubscribe**: paste numbers to take them off the list again.

Every change is written to the audit log (`unsubscribe.add`, `unsubscribe.remove`,
`unsubscribe.import`).

## Unsubscribe API

Call these from your CRM or landing page to unsubscribe a contact in real time. Replace the
placeholders in triple braces with the actual value; GET and POST (JSON or form) both work.

| Use when | URL |
| --- | --- |
| You send a per-contact identifier with the campaign | `https://<worker-address>/unsubscribe/<account>?type=rm-fk&fk={{{dynamic}}}` |
| You have the phone number in international format | `https://<worker-address>/unsubscribe/<account>?type=rm-u&number={{{number}}}` |

`{{{dynamic}}}` is the dynamic id Sendex puts in the tracked link of every message (the same
one postbacks use). The answer is JSON: `unsubscribed` says whether a contact was found and
`added` whether it was new on the list. The endpoint is rate limited per account.
