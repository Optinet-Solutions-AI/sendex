---
title: Numbers verification
description: Enrichment rules, HLR Verify, the verification log and the lookup coverage under Contacts › Enrichment.
---

**Contacts › Enrichment** (Numbers Verification) keeps your numbers checked against the
mobile networks: an HLR lookup says whether a number is live and on which operator, an MNP
lookup whether it was ported. Each lookup costs a small amount per number, charged to your
balance as the lookups run.

## The page

- **KPI strip**: Total unique numbers, Total scanned, Total good, Total bad, Not checked.
- **Enrichment rules**: one rule per country. **+ Add rule** asks for the country, the
  **daily limit** (numbers verified per day), the **monthly budget** in EUR, **when to run**
  (on a schedule, after an upload, as you send) and whether to **include archived lists**.
  A scheduled rule runs from the worker's tick, verifying the country's unverified numbers
  up to what the day's limit and the month's budget still allow.
- **Verification log**: one row per day and country (Total, Good, Bad, No verdict), with a
  period (7d, 30d, 90d, All, Custom), a country filter and **Download summary** (CSV).
- **Country network breakdown**: the operators the lookups named, with how many numbers
  are ported.
- **Verification coverage**: pick a country to see the lookup route, method and price per
  number.

## HLR Verify on a list

On a list's **Lookup** tab, **🛡 HLR Verify** shows how many numbers have no lookup yet and
what they would cost, then queues a request. The Lookup tab's columns (HLR, MNP, Unresolved,
Local only, Checking, Cached) fill in as results arrive; numbers the carrier reports as
**Bad** are flagged bad on the list, and unsubscribed numbers are stored as **Blacklisted**.

## Statuses

| Status | Meaning | Verdict |
| --- | --- | --- |
| HLR-checked | Live on the network | good |
| MNP (ported) | Live, ported to another operator | good |
| Local only | Format valid, no network answer available | good |
| Unresolved | The carrier gave no answer | none |
| Checking | A request is in progress | none |
| Bad | Not live, rejected by the network | bad |
| Blacklisted | Unsubscribed on this account | bad |

## Provider

Lookups go through a provider behind one interface, like carriers. No HLR or MNP account is
connected yet: rules and HLR Verify queue requests, and the page says so. For development
the worker can run the deterministic fake (`LOOKUP_PROVIDER=fake`). The prices per country
live in a platform table (`lookup_prices`), seeded with sample values.
