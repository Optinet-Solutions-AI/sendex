# ADR 0012: Revenue comes from brand deals, not from the tracker's amount

Date: 2026-11-25. Status: accepted; the rules marked "open" wait for confirmation from the team.

## Context

Until now a deposit's revenue was the `value` the tracker sent with the sale postback, or, without one, the offer's "Profit (€)" field (copied from SMS Edge). On 24 November 2026 Christian pointed out that the tracker's amount is not what we earn: for Scaleo it is probably the player's deposit, and what a brand pays us is only known from the deals recorded in Media Deals, our own deals tool. Deals differ per brand and change over time.

Media Deals already exports its deals (CSV/Excel) with the columns `Affiliate Program Name`, `ALL BRANDS`, `Deal`, `Top Geos` and others, including logins. Reading its 101 deals on 25 November 2026: the deal is free text such as "€200 CPA + 40% rev + €20 base"; most have a single euro CPA, some are in dollars, some are revshare only, and some are not priced at all ("No Deal Yet"). None has a price per registration, and the export carries no date.

## Decision

- **Revenue is the brand deal's CPA, once per first deposit.** A message's first sale postback earns the CPA of the deal chosen on the message's offer, in force on the day the postback came; it is stored on the postback (`postbacks.revenue_micro`) and summed on the lap (`laps.revenue_micro`). Repeat deposits and registrations earn nothing. Every revenue figure (campaign results, Dashboard, Performance, list details, public API) reads these.
- **The tracker's amount stays, as data.** `postbacks.value_micro` is still stored and shown as "Tracker amount" in the Postback Logs. `links.profit_micro` stays in the schema but is no longer read for revenue.
- **Deals come from the Media Deals export, uploaded as it is.** Settings → Brand deals reads only the program, brands, deal, top geos and an optional start date column; the browser drops every other column before sending, so logins and contacts never reach Sendex. One deal per program and brand (`deal_key`), since a brand can come through two programs.
- **Only a euro CPA becomes a price.** Revshare and base are left out; a deal in another currency, without a currency, with more than one CPA amount, or without a CPA is listed with the reason and earns nothing.
- **Prices are dated.** Each upload has a start day (the upload day by default, or a row's own date); a new day adds a price and keeps the old ones, so a deposit keeps the price of its day. The same brand on the same day is replaced.
- **Each offer is given its deal by hand**, with a suggestion when a brand's name is in the offer's name. An offer without a deal earns nothing.
- **Past deposits are worked out again** after each upload and each change of an offer's deal, for the whole organisation, in one transaction.

## Open (waiting for the team)

- Whether prices should apply from the upload day, or from a date Danny records with each deal. The upload takes both; which one the team uses is their call.
- Whether revshare, base payments or registrations should ever count. Today they do not.
- Deals in dollars: today they earn nothing rather than a converted amount.

## Consequences

- Until deals are uploaded and offers are given their deal, every organisation shows no revenue, where before it showed the tracker's amounts. The migration (`0030_brand_deals`) sets every lap's revenue to 0 so campaign pages and the Dashboard agree.
- Made-up revenue loaded straight into an organisation for a presentation (laps or postbacks written by hand) is replaced by the deal-based figure the first time deals are uploaded or an offer's deal is changed in that organisation.
- A brand whose deal is written as free text earns nothing until the deal is written with a euro CPA in Media Deals and uploaded again.
