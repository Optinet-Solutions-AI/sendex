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

## Lists tab

Pick the campaign's audiences: the **Lists** of the campaign's country (with their progress
bar, sent and bad counts and a per-list flush) and, above them, your **Segments**. A segment
audience sends only to the contacts that match its rules, one lap per list they live in; the
number on the right is how many can still be sent to. **+ Create Segment** opens the builder.

## Routes tab

The routes you pick are saved on the campaign straight away, in the order you pick them, so
they are still picked when you come back to it, and **Duplicate** copies them. Only routes
your organisation can use for the campaign's country are kept.

Under the route picker, **{Country} Routes Performance** shows two tables, each switchable
between Daily, Weekly and Monthly: **Platform Statistics** ranks every platform route for the
country by CTR, by cost per click and overall, pooled across all accounts on the platform
(ranks only, never anyone's numbers; "–" when a route carried nothing in the period), and
**Account Statistics** is your own cost, sent, clicks, CTR and CPC per route.

## Steps

1. Open **Campaigns** and press **+ New Campaign**: name, country, and the UI timezone that follows the country. The campaign opens on its page.
2. The page is one card, **Send this campaign**: the form on the left, a context panel on the right. Each row of the form opens the matching tab on the right, where the details are managed.
3. **SIDs**: pick a SID group in the select, or open the SIDs tab for **+ New group** and **+ Add SID**. Only one group is active per campaign; each sender ID has its own switch.
4. **Lists**: open the Lists tab and tick the lists of the campaign country. Each row shows its progress bar, **Sent 600 / 1,896**, Bad, and a flush button that resets its sending progress.
5. **Offers**: open the Offers tab, choose an existing offer or **— New offer —** with a name, the URL and the token chips (Dynamic, Geo, Phone, First Name, Campaign ID, Route Name, Custom 1–5, …). **Advanced › Profit (€)** records the revenue per conversion for ROI. Press **Add Offer**.
6. **Ad Texts**: open the Ad Texts tab, **+ Add Texts**, and write the message with `{{domain}}` where the link goes. Several texts at once are separated by a line containing only `//`. The red counter shows `GSM_7BIT · chars · parts · left`, counting `{{domain}}` at the real short link length, so the parts it shows are the parts you are billed for; keep to one part where you can. **Check {{domain}} exists** is on; **Long message** is off, so a text over one part cannot be saved until you switch it on. `{word1|word2}` picks one word per message; `{{last_name}}` is under **More**. There is no opt-out placeholder yet: write the opt-out wording into the text.
7. **Routes**: open the Routes tab and tick the routes to test; the price per SMS is shown next to each.
8. **Advanced Settings** (switch): Send All, the test size, the contact reuse cards and Run AutoSender.
9. The dark bar at the bottom shows **CONTACTS · SIDS · TEXTS · OFFERS · TEST SIZE · SMS · COST** and the first thing still missing. **Send** lights up once the setup is valid; see [Send and scale](/using/send-and-scale/).

## Good texts

- Keep to one SMS part where you can; the link is short but it still counts.
- Avoid characters outside GSM-7 (curly quotes, emoji, some accented letters) unless you need them, because a single one switches the whole message to UCS-2 and halves the characters per part.
- Say who you are. Sender IDs are not shown on every network, and a message that does not name the brand is reported as spam.
