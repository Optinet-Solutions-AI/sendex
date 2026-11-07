---
title: Segments
description: Saved audiences built from rules over your contacts and their history, evaluated live when you send.
---

A segment is a saved query: rules over your contacts and everything Sendex knows about them
(lists, country, sends, clicks, deliveries, leads, sales, devices and networks). It is
evaluated live, so a segment named "ES clickers" always means the contacts that match
**now**. Contacts stay in their source lists; a segment never copies them.

## The Segments page

**Contacts › Segments** lists every segment under three tabs: **All**, **Templates** (starting
points that are not audiences) and **Global Excludes** (segments subtracted from every
campaign). Each row shows the name with its rule summary, **Size** and **Good** (the last
Refresh Stats; grey bars while they load), flags, the created date, and edit, duplicate and
delete. **Refresh Stats** recounts every segment.

## The builder

**+ New Segment** opens the builder: a name, the **Rules** card and the **Global negative
segment** switch on the left (plus the **AI Rule Generator** when it is turned on); the live
**Preview** on the right.

- **Rules** are a tree: an AND / OR toggle, one row per rule (field, operator, value) and
  **Add Rule** / **Add Group**. Groups nest, each with its own AND / OR and **Remove group**.
- An incomplete rule is outlined in red and listed in the amber banner, for example
  "Rule 1 (Country): missing value". **Save** stays disabled until every rule is complete
  and the segment has a name.
- The **Preview** shows Total, Good (not unsubscribed, in at least one list as a good
  number) and Cached, with a Sample of masked numbers and Countries, Networks and Devices
  breakdowns. It updates half a second after you stop editing.
- **Global negative segment**: numbers matching the segment are excluded from every campaign
  of the account, at send time.
- **Save as template** keeps the segment under Templates.

Editing a saved segment shows the same builder with the saved rules, Segment Analytics and
**Export CSV** (every matching number).

## Using a segment in a campaign

On a campaign's **Lists** tab, the **Segments** section lists your segments (templates and
global excludes aside). Tick one and it becomes an audience next to the lists: when you
send, Sendex plans one lap per list the matching contacts live in (in the campaign's
country), limited to those contacts, and the lap table shows the segment next to the list.
The count on the right is how many matching contacts can still be sent to.

Global excludes need no ticking: every campaign skips their contacts at send time, like the
unsubscribe list.

## Fields

The field picker groups the fields the way SMS Edge does; fields marked **click data** come
from link-click tracking.

| Group | Fields |
| --- | --- |
| List | List; List Name, List Created (more) |
| Identity | Country; Number Added, First Name, Last Name, Email (more) |
| Engagement | Sent Count, Clicks Count, CTR Level; Leads, Sales, Cost Per Click, DLR delivery rate, rejected, expired, delivered (more) |
| Recency | Last Received SMS, Last Clicked; Last Lead, Last Sale (more) |
| Campaign Activity | Sent in Campaign, Lead in Campaign; Clicked in Campaign (more) |
| Device & Network | Device, Mobile Network |
| Enrichment | Browser, Click Country |

Operators follow the field: equals / in for choices, contains for text, comparisons and
between for numbers, and "in the last … days", before, after, is set for dates. Voice,
language, city, time zone and operating system fields wait for a data source.

## AI Rule Generator

Describe the audience in plain English ("UK clickers from the last 30 days") and
**Generate** turns it into rules; with rules already there it adds to or amends them. The
generator uses the Claude API and is **off by default**: set `ENABLE_AI_RULES=1` and
`ANTHROPIC_API_KEY` on the web app to show it. While it is off the builder has no AI card
and rules are added by hand.
