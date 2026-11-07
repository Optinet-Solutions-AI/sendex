---
title: Routes
description: Platform Routes, Custom Routes (your own SMPP or HTTP carriers), Testing with Send Single, and Mobile Networks.
---

**Routes** in the sidebar holds four pages. A **platform route** is one Sendex rents and
resells; a **custom route** is a carrier connection you bring yourself, used only by your
organisation and billed at a small platform fee per SMS on top of the carrier's price.

## Platform Routes

**Routes › Platform Routes** shows what your account can send through and how it delivered.

- Filters: countries, "Search route or country…", the period (All time, 7d, 30d, 90d,
  Custom) and ↻ Refresh.
- KPI strip: Routes, Countries, Sent, Clicks, CTR, Total cost.
- **Available Routes**: one row per route and country with the current price, sorted by
  country A→Z. A route can appear in several countries at different prices.
- **Delivery Report**: country · gateway (with its price) · sent · clicks · CTR · total
  cost · CPC, one row per country and route pair, busiest first, for the chosen period.

## Custom Routes

**Routes › Custom Routes** lists your own carriers. The header says the platform fee
(€0.01 per SMS by default) and how many routes are active. Only owners manage routes;
campaign managers and viewers can see them.

- **Routes** tab: the status eye (on or off), name and host, an HTTP or SMPP badge, the
  countries it is priced for ("No pricing" until you add some), the status badge, and the
  actions: ✎ Edit, $ Pricing, ➤ Test Connection and 🗑 Delete.
- **+ Add Route** opens **Add Custom Route**: a name and the connection type. **HTTP API**
  takes the API URL with `{{{from}}}`, `{{{number}}}` and `{{{text}}}` placeholders, a
  username and password, "Use POST method" and custom headers. **SMPP** takes host, port,
  system ID, password, an optional system type and TLS. Passwords are sealed before they
  are stored and never shown again; leave the field blank when editing to keep the one on
  file.
- **Pricing**: one line per country with the price per SMS part in EUR. A route only
  covers a country once it has a price there.
- **Routing Configuration**: the default strategy, **Custom routes first**, **Blended** or
  **Platform routes first**, applies to every country unless a **per-country exception**
  locks one route, switches some off or sets an order. The campaign Routes panel and the
  Send Single dialog list routes in that order.
- **Stats**: **Sending Statistics** (by route, + country), the **SMS Log** of recent sends
  and the **SMPP Connection History**.

**Test Connection** needs the worker-side custom-route adapter, which is not deployed yet;
until it is, custom routes can be stored and priced but a lap on one is cancelled as "cannot
be served". The ledger already writes the platform fee as its own `fee` entry next to the
message debit when the adapter sends.

## Testing

**Routes › Testing** is the **SMS Tests** table: ID, tests ran, success rate, country,
routes, sender id, recipient, text preset, created / last sent, cost, queue status and a
remove action. Filter by country, "show removed", the **Singles** toggle; **Cost Report**
sums tests per month.

- **➤ Send Single** sends one message to a number you control: destination country,
  recipient (digits, international format), the routes of that country (in routing order,
  with prices), **Schedule Sending** (days of the week and 15-minute UTC slots), the sender
  id modes (Random String, Random Casino Name, Random Shop Name, Custom), the text presets
  or a custom text, a hypothesis, **Jitter** (a random pause between tests) and **Cascade
  Mode** (try the routes in order and stop at the first that accepts). The **Cost
  Estimate** multiplies sender ids × texts (× routes without cascade). The worker picks the
  test up within a few seconds; scheduled tests fire once per slot.
- **+ Test SMS** sends to real handsets through a test-network provider. None is connected
  yet, so the dialog explains that and its Send button stays off.
- The campaign page's **Send Single** tab is the same form with the campaign's country
  preselected.

## Mobile Networks

**Routes › Mobile Networks** compares operators within each country: KPIs (countries,
networks, sent, clicks, CTR, leads, sales), one collapsible card per country with sent and
the country CTR, and per operator: sent, previews, clicks, CTR with its delta against the
country, leads, sales and the share of the country. › expands the routes carrying that
operator. Operators under 100 messages are hidden behind "Show low-volume networks (n)".

The operator comes from the carrier's delivery receipt when it reports one, or from the
network of the first click; messages with neither are grouped as **Unresolved** until an
HLR or MNP lookup provider is connected.
