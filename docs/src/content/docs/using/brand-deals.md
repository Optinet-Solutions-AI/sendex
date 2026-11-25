---
title: Brand deals
description: Upload the Media Deals export so each first deposit earns its brand's CPA, and choose the deal each offer earns from.
---

Revenue in Sendex comes only from the deals we have with brands, as recorded in Media Deals. Each **first deposit** earns the **CPA** of the brand deal chosen on its offer, at the price in force on the day of the deposit. The amount a tracker sends with a deposit postback (Scaleo's `value`, for example) is kept in the Postback Logs as **Tracker amount**, but it is not revenue.

Open **Settings → Brand deals**. Everyone can see the page; uploading and choosing deals needs the right to manage settings.

## 1. Upload the deals

Export the deals from Media Deals as CSV or Excel and upload the file as it is. Sendex reads these columns, matched by name whatever the case:

| Column                   | Also accepted as                      | Used for                                    |
| ------------------------ | ------------------------------------- | ------------------------------------------- |
| `Affiliate Program Name` | `Affiliate Program`, `Program`        | which program the deal is with              |
| `ALL BRANDS`             | `Brands`, `Brand`, `Brand Name`       | one deal per brand; split on `\|` and lines |
| `Deal`                   | `Commercial Deal`                     | the CPA, e.g. `€200 CPA + 40% rev`          |
| `Top Geos`               | `Geos`                                | shown only                                  |
| `Start Date` (optional)  | `Date`, `Valid From`, `Effective Date` | the day the price starts                    |

Every other column (Contact, Telegram, Skype, User Name, PASS, Email, Comments, ...) is dropped in your browser before anything is sent: logins and contacts never reach Sendex.

An example file with made-up programs and brands: [brand-deals-example.csv](/examples/brand-deals-example.csv).

**Prices apply from** is the day the prices start, today by default. A row with its own date in a `Start Date` column starts on that day instead (`2026-11-01`, `01/11/2026` or `01.11.2026`). Upload the same brand again for the same day and it is replaced; a new day adds a new price and keeps the old one, so deposits made earlier keep the earlier price.

### What becomes a price

Only a **CPA in euros** is counted, once per first deposit:

| Deal as written                  | CPA counted                    |
| -------------------------------- | ------------------------------ |
| `€200 CPA + 40% rev + €20 base`  | €200 (revshare and base left out) |
| `180€ CPA`, `EUR 150 CPA`        | €180, €150                     |
| `40% rev share`, `No Deal Yet`   | none: "No CPA in the deal"     |
| `$200 CPA`                       | none: "CPA not in euros"       |
| `120 CPA + 35%`                  | none: "No currency on the CPA" |
| `€300 CPA + €30 CPA + €20 CPA`   | none: "More than one CPA in the deal" |

A deal without a price is still listed, with the reason, so it can be fixed in Media Deals and uploaded again.

## 2. Choose the deal for each offer

Under **Offers**, each offer of the organisation has a deal choice. When an offer's name contains a brand (for example "Smash Casino UK"), a **Use Smash Casino?** link suggests it. A choice saves at once. An offer with **No deal** earns nothing.

## What changes after an upload or a choice

Sendex works out all past first deposits of the organisation again: each earns the CPA of its offer's deal in force on the day it came, or nothing. Campaign results, the Dashboard, Performance and list details all show that revenue; profit is revenue minus cost.

Repeat deposits on the same message earn nothing. Registrations earn nothing: Media Deals has no price per registration.
