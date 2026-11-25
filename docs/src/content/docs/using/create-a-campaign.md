---
title: Create a campaign
description: Combine a country, lists, a sender ID group and a message text with a tracked link into a campaign.
---

A campaign is **one country, one or more lists from that country, one sender ID group, and one text**. The text carries a `{{domain}}` placeholder that Sendex replaces with a unique short link per recipient, which is how clicks are attributed back to the campaign and route.

## The four parts

- **Country.** Fixes which lists you can pick, which routes can carry the campaign, which sender IDs are allowed, and the timezone used for scheduling. Only the countries that are open can be picked: for now that is the **United Kingdom**. The other countries stay in the list, greyed out, and cannot be selected; copying a campaign of a closed country, or starting one from a list of a closed country, is refused with the same message.
- **Lists.** Any number of lists from the campaign country. Numbers that appear in more than one list are sent once.
- **Sender ID group.** A named set of sender IDs (alphanumeric or numeric). Sendex rotates through the group and only keeps the ones each route and country accept.
- **Text.** The message body. Write `{{domain}}` where the link should go; the counter under the text box shows the GSM-7 or UCS-2 character count and how many SMS parts the message will cost, taking the length of the short link into account.

## Lists tab

Pick the campaign's audiences: the **Lists** of the campaign's country (with their progress
bar, sent and bad counts and a per-list flush) and, above them, your **Segments**. A segment
audience sends only to the contacts that match its rules, one lap per list they live in; the
number on the right is how many can still be sent to. **+ Create Segment** opens the builder.

The **Lists** row of the form on the left is a dropdown as well: click it, type part of a list
name in the box (any words of the name, in any order) and the lists narrow as you type. Press
**Enter** to pick the first match, or tick and untick lists with the mouse. Every change is
saved at once, and the Lists tab opens next to it with the details.

## Routes tab

The routes you pick are saved on the campaign straight away, in the order you pick them, so
they are still picked when you come back to it, and **Duplicate** copies them. Only routes
your organisation can use for the campaign's country are kept.

**After a test.** Once a route has sent in this campaign, its line shows what it did here,
for example "100 sent · 0 clicks" ("still sending" while a lap on it is queued or running).
When one or more picked routes have finished sending and got no click, a notice names them
and **Remove n routes with no clicks** unticks them in one go, so the next send only uses
the routes that worked. A route that is still sending, or that has not sent yet, is never
removed, and you can tick a removed route again at any time.

Under the route picker, **{Country} Routes Performance** shows two tables, each switchable
between Daily, Weekly and Monthly: **Platform Statistics** ranks every platform route for the
country by CTR, by cost per click and overall, pooled across all accounts on the platform
(ranks only, never anyone's numbers; "–" when a route carried nothing in the period), and
**Account Statistics** is your own cost, sent, clicks, CTR and CPC per route.

## Steps

1. Open **Campaigns** and press **+ New Campaign**: name, country, and the UI timezone that follows the country. The campaign opens on its page.
2. The page is one card, **Send this campaign**: the form on the left, a context panel on the right. Each row of the form opens the matching tab on the right, where the details are managed.
3. **SIDs**: pick a SID group in the select, or open the SIDs tab for **+ New group** and **+ Add SID**. Only one group is active per campaign; each sender ID has its own switch.
4. **Lists**: click the Lists row and type the list's name, or open the Lists tab and tick the lists of the campaign country. Each row shows its progress bar, **Sent 600 / 1,896**, Bad, and a flush button that resets its sending progress.
5. **Offers**: open the Offers tab, choose an existing offer or **— New offer —** with a name, the URL and the token chips (Dynamic, Geo, Phone, First Name, Campaign ID, Route Name, Custom 1–5, …). Press **Add Offer**. What the offer earns per first deposit is its brand deal, chosen in **Settings → Brand deals** ([Brand deals](/using/brand-deals/)); **Advanced › Profit (€)** is kept from SMS Edge but no longer counts as revenue.
6. **Ad Texts**: open the Ad Texts tab, **+ Add Texts**, and write the message with `{{domain}}` where the link goes. Several texts at once are separated by a line containing only `//`. The red counter shows `GSM_7BIT · chars · parts · left`, counting `{{domain}}` at the real short link length, so the parts it shows are the parts you are billed for; keep to one part where you can. When Sendex sends through a link shortener, the link in the SMS is shorter than the one counted here and its address changes with every lap; you are then billed for the parts really sent, which can be fewer than shown, never more. **Check {{domain}} exists** is on; **Long message** is off, so a text over one part cannot be saved until you switch it on. `{word1|word2}` picks one word per message; `{{last_name}}` is under **More**. There is no opt-out placeholder yet: write the opt-out wording into the text.
7. **Routes**: open the Routes tab and tick the routes to test; the price per SMS is shown next to each.
8. **Advanced Settings** (switch): Send All, the test size, the contact reuse cards and Run AutoSender. Contact reuse decides whether numbers other campaigns already messaged count: with **Account-wide** they stay blocked until you flush the list; with **Per campaign** a new campaign (a duplicate too) reaches the whole list, and its first send flushes its lists for you. Either way a campaign messages each number only once.
9. The dark bar at the bottom shows **CONTACTS · SIDS · TEXTS · OFFERS · TEST SIZE · SMS · COST** and the first thing still missing. **Send** lights up once the setup is valid; see [Send and scale](/using/send-and-scale/).

## Good texts

- Keep to one SMS part where you can; the link is short but it still counts.
- Avoid characters outside GSM-7 (curly quotes, emoji, some accented letters) unless you need them, because a single one switches the whole message to UCS-2 and halves the characters per part.
- Say who you are. Sender IDs are not shown on every network, and a message that does not name the brand is reported as spam.
