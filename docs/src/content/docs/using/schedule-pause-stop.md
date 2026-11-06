---
title: Schedule, pause and stop
description: Start a campaign at a local time, change or cancel the schedule, pause and resume, stop for good, or halt the whole organisation with the emergency stop.
---

A campaign can start now or at a chosen time in the **campaign country's timezone**. While it runs you can pause it, resume it, or stop it for good. If something is badly wrong, an owner can hit the organisation-wide **Emergency stop**.

## Schedule a send

1. Open the campaign. In the **Schedule** panel switch **Send Now** off and pick a start date and time. The time is the campaign country's local time (the note under the field says which zone, e.g. `ES local time; will be sent according to Europe/Madrid`). Save it.
2. Build the rest of the send as usual (sender ids, lists, texts, routes) and press **Send**. The laps are queued and the campaign shows as **scheduled**; nothing goes out until the start time.
3. The **Scheduled** page in the left menu lists every upcoming send of the next 30 days, grouped per day in each campaign's own timezone, with the planned laps and SMS count. Open a campaign from there to change it.

The start time is stored in UTC together with the campaign timezone, so a campaign for Spain set to 10:00 goes out at 10:00 in Madrid whatever your own clock says. The worker checks every few seconds for scheduled campaigns whose time has come.

## Change or cancel a schedule

On a scheduled campaign the page shows **Scheduled for &lt;time&gt;** with two actions:

- **Change time**: enter a new local time and press the button. The queued laps stay queued and simply wait for the new time; the old time no longer fires.
- **Cancel schedule**: the queued laps are dropped and the campaign goes back to **draft**, keeping its lists, texts and settings. Pick a new time (or Send Now) and press Send again whenever you are ready. Nothing was sent, so nothing is charged.

Both actions are written to the campaign's **Logs** tab.

## Pause and resume

**Pause** holds the campaign where it is. The lap that is running finishes the batch it is on (up to 50 messages), then waits; no new lap is started. Messages already handed to the carrier still go out.

**Resume** carries on from the next unsent contact. No contact is sent twice: the engine only ever picks contacts that have no message in the campaign yet. A paused campaign whose start time is still ahead goes back to **scheduled** on resume.

Pausing needs the `campaign.stop` permission (owners and campaign managers); resuming needs `campaign.send`.

## Stop

**Stop** ends the campaign. You are asked to confirm, and the dialog says how many contacts remain unsent. Then:

- every queued or running lap becomes **cancelled**; a running lap stops after its current batch;
- messages that were created but not yet handed to the carrier are cancelled and refunded;
- the campaign shows as **stopped** and cannot be resumed. To reach the remaining contacts later, duplicate the campaign (the lists are reused; contacts already messaged are skipped by the reuse rule).

Messages the carrier already accepted are not recalled, so the sent count can still rise slightly after you stop, and their delivery receipts are still recorded.

## Emergency stop (owners)

**Settings → Emergency stop** halts everything the organisation is sending at once: every running lap stops after its current batch, nothing new is dispatched, and scheduled sends wait. Give a short reason (it is kept in the audit log) and confirm. While it is active, a red bar at the top of every page says so.

**Clear emergency stop** on the same page lets campaigns that are still **sending** carry on. Laps the stop cancelled are not restarted; use **Finish List** on the campaign to send what is left. Both the stop and the clear are audited with who did it and when.

## What you see where

| Where | What it shows |
| --- | --- |
| Campaign header badge | `scheduled`, `sending`, `paused`, `stopped` |
| Laps table | each lap `queued`, `sending`, `done` or `cancelled` |
| Logs tab | `campaign.pause`, `campaign.resume`, `campaign.stop`, `campaign.reschedule`, `campaign.schedule_cancel`, and `lap.cancel` per lap |
| Audit log (owners) | the same, plus `emergency.stop` and `emergency.clear` |
