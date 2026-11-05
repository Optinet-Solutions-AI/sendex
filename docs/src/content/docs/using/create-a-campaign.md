---
title: Create a campaign
description: Combine a country, lists, a sender ID group and a message text with a tracked link into a campaign.
---

A campaign is **one country, one or more lists from that country, one sender ID group, and one text**. The text carries a `{{domain}}` placeholder that Sendex replaces with a unique short link per recipient, which is how clicks are attributed back to the campaign and route.

## The four parts

- **Country.** Fixes which lists you can pick, which routes can carry the campaign, which sender IDs are allowed, and the timezone used for scheduling.
- **Lists.** Any number of lists from the campaign country. Numbers that appear in more than one list are sent once.
- **Sender ID group.** A named set of sender IDs (alphanumeric or numeric). Sendex rotates through the group and only keeps the ones each route and country accept.
- **Text.** The message body. Write `{{domain}}` where the link should go; the counter under the text box shows the GSM-7 or UCS-2 character count and how many SMS parts the message will cost, taking the length of the short link into account.

## Steps

1. Open **Campaigns** and choose **New campaign**. (coming on Day 2)
2. Pick the **country**.
3. Tick the **lists** to include. The total unique numbers updates as you tick.
4. Pick a **sender ID group**, or create one first under **Sender IDs**.
5. Write the **text** and place `{{domain}}` where the link goes. Check the part count: a text that fits in one part costs a third of one that needs three.
6. Set the **destination URL** that the short link redirects to. Add `{{click_id}}` to it if your landing page will send registration and sale postbacks.
7. **Save**. The campaign is created in the draft state; nothing is sent until you start a test batch from [Send and scale](/using/send-and-scale/).

## Good texts

- Keep to one SMS part where you can; the link is short but it still counts.
- Avoid characters outside GSM-7 (curly quotes, emoji, some accented letters) unless you need them, because a single one switches the whole message to UCS-2 and halves the characters per part.
- Say who you are. Sender IDs are not shown on every network, and a message that does not name the brand is reported as spam.
