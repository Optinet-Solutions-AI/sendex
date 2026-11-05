---
title: Daily caps and alerts
description: Cap how many messages and how much money an organisation can send per day, and read the alerts banner.
---

Two guard rails stop a mistake from becoming an expensive day: a **daily message cap** and a **daily spend cap** per organisation, and a set of **alerts** that appear as a banner at the top of every page. Owners set the caps under **Settings → Billing** and acknowledge the alerts from the banner; both are written to the audit log.

## Setting the caps

Under **Settings → Billing**, in **Daily caps**:

| Setting | Meaning |
| --- | --- |
| **Messages per day** | How many messages the organisation may send in one day, across all its campaigns. Blank means no cap. |
| **Spend per day (EUR)** | How much the organisation may be charged in one day, across all its campaigns. Blank means no cap. |

Only an owner can change them. Each save is logged as `settings.update` in the audit log.

A "day" is a UTC day: the counters start again at midnight UTC, whatever the campaign's timezone. The message count includes every message the engine created that day (sent, delivered, failed), not the ones that were cancelled before they went out; the spend is what was charged for messages that day less what was refunded for failures.

## What happens when a cap is reached

The sending engine checks the caps before every batch of a lap, so a running send stops at the cap rather than overshooting it:

1. The batch is trimmed to what still fits today and sent.
2. The rest of the lap is **refused**. The lap finishes with what it sent; its row on the campaign page shows `refused: daily cap (100)` (or `daily spend cap`) under its status.
3. The campaign is **paused**, not stopped, and the pause is logged as `campaign.pause` with the reason. Nothing else of that campaign is dispatched until you resume it.
4. An alert is raised, once per day per cap, in the dashboard banner.

To carry on: raise (or clear) the cap under **Settings → Billing**, or wait for the next UTC day, then resume the campaign and use **Finish List** on the lap's route to send the numbers that were refused. The refused numbers were never charged and are still available to send.

The check is per batch, so two laps of the same organisation sending at the same moment can each send one more batch (50 messages) past the cap before both stop. Set the cap with that margin in mind.

## Alerts

| Alert | When |
| --- | --- |
| **Daily message cap** / **Daily spend cap** | A lap was refused because the cap was reached. Once per day per cap. |
| **Sending spike** | More than five times the organisation's seven-day hourly average was sent in the last hour (and at least 100 messages). Checked every five minutes, raised at most once per hour. |
| **Low balance** | The balance dropped below the threshold set under **Settings → Billing**. Once per dip: it arms again when a deposit brings the balance back to the threshold. |

Every open alert is shown in the amber banner at the top of each page, with a shortcut to where it is fixed (**Raise the cap**, **Fund the account**). An owner clicks **Acknowledge** to clear it; the acknowledgement is logged as `alert.acknowledge`. Raising an alert is logged as `alert.raise`.

Email delivery of the alerts (to the addresses under **Low balance alert**) arrives with a later card; today the banner, the audit log and the worker's logs are where they show.
