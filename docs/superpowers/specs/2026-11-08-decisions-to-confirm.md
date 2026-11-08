# Decisions to confirm with Meny and Alex

Date: 2026-11-08. Status: questions ready, not yet asked. Reviewed by Christian over three rounds in the local "Sendex Decisions to Confirm" page.

## Why this exists

While building Sendex we made business decisions ourselves: how money, tracking and sending work. Meny and Alex know the casino and SMS business better, so these choices must be confirmed with them instead of improvised. This page lists the questions to ask and what was already settled.

Every question is based on one of three sources, named after it:

- **Emily** or **Meny**: said in the 5 Nov 2026 meeting (Emily's SMS Edge walkthrough, Meny at the end). The time is the position in the recording `qwx-tyti-vjf (2026-11-05 20_30 GMT+8).mp4`.
- **SMS Edge**: seen on an SMS Edge screen (the SMS Edge Build Spec and screen notes, 7 Nov 2026).
- **Ours**: our own choice while building Sendex, with no outside source. Marked so nothing looks borrowed that is not.

## Already settled

- **Sendex is internal.** It is only for our team, not a SaaS. No client invoicing, credit or per-client prices.
- **Copy SMS Edge where it shows the answer**, instead of asking:
  - **Long messages:** SMS Edge has a Long message toggle on each ad text, off by default. Sendex gets the same toggle, and a text longer than one SMS is refused unless it is on. *To build.*
  - **Sales count:** SMS Edge shows campaign sales as "Sales (FTD)" and the dashboard shows unique buyers. Sendex should count first deposits only on the campaign. *To build.*
  - **Test costs:** SMS Edge keeps test SMS costs in their own Cost Report (Routes › Testing), not in campaign cost. Sendex already does this.
- **Dropped or set aside:** the custom-route €0.01 fee (SMS Edge's fee to its clients, irrelevant for an internal tool), prepaid EUR and invoicing, repeat-deposit duplicates (set aside), postbacks without a click, lap rank (stays on CTR, as Emily said), sender IDs and test texts (the user's choice), the campaign time zone (picked per campaign, as in SMS Edge).

## Questions

### Costs

- **When we charge:** Is it fine that we take the money when the campaign is queued and refund whatever doesn't go out (failed, stopped, switched off)?
  *Emily 30:40: SMS Edge billing lists "unsent message refund · campaign · lap".*
- **Refunds:** SMS Edge gives money back on some messages. Exactly which ones: only unsent, or also undelivered? Does 23Telecom refund undelivered messages?
  *Emily 28:03, "campaigns that we usually get money back on"; Emily 30:40.*
- **Price changes:** When 23Telecom changes a price, how do we hear about it, and who updates it in Sendex?
  *Emily 41:30, SMS Edge prices "can change, but from their admin side"; Ours: Sendex keeps the price entered until someone changes it.*

### Leads and sales

- **Knowing about conversions:** How do we know when an SMS brought a conversion (a sign-up or a first deposit)? Where do you see it, and how does it get into SMS Edge?
  *Emily 08:20, the offer link's dynamic field "helps it connect with Tableau"; SMS Edge: offer URL `…?id={{{dynamic}}}`.*
- **Postback URLs:** Do you use postback URLs to send sign-ups and deposits into SMS Edge? If yes, from which system?
  *SMS Edge: Reports › Postback Logs; Emily 32:57.*
- **Leads and sales:** Are leads and sales set automatically by your tracking, or does someone tag them by hand? Does a sale always mean the first deposit (FTD)?
  *Emily 27:28, a filter for campaigns "that got an FTD"; SMS Edge: "Sales (FTD)".*
- **Late conversions:** Should Sendex count conversions that come weeks after the SMS, or leave those to Tableau?
  *Emily 08:29, late conversions are seen in Tableau.*
- **Who gets the credit:** If someone got texts from two campaigns and then signs up, which campaign gets the credit: the one whose link they used?
  *Ours: how Sendex credits a conversion today.*
- **Revenue:** Can the tracking system send amounts in other currencies? Should revenue be the player's deposit, or what we actually earn per player?
  *SMS Edge: Offers › Advanced › Profit (€), "revenue per conversion for ROI"; Emily 02:44 wants ROI.*
- **Which day:** When a deposit comes days after the SMS, should reports put it on the day of the SMS or the day of the deposit?
  *Emily 08:29; Ours: Sendex books it on the day of the SMS.*

### Report formulas

- **Formulas:** Do you calculate cost per lead, cost per sale, CTR and ROI the same way in your sheets or Tableau?
  *Emily 05:34, CTR = clicks ÷ sent; Emily 02:44, cost per sale and per sign-up.*
- **Under-worked countries:** On the dashboard's Countries tab, we mark a country Under-worked when it has been sent to less than half its contacts. Is that how you judge it, or what do you look at?
  *SMS Edge: Countries tab utilisation map; Ours: the badge and the 50% line.*

### Numbers and lists

- **Number cleaning:** Do you use anything besides Google's libphonenumber, or other software, to clean numbers before sending?
  *Emily 34:50, "the logical check means remove landlines and invalid numbers"; Ours: using libphonenumber.*
- **Suspicious numbers:** Should the system flag suspicious numbers automatically? What patterns do you know of?
  *SMS Edge: "Suspicious digit pattern (likely fake) — added as bad"; Ours: our exact patterns.*
- **Number checks (HLR):** Which provider, which countries, and when? Is SMS Edge's number verification a separately paid service?
  *Emily 39:32, a daily limit and budget per country; SMS Edge: Contacts › Enrichment.*
- **One country per list:** Is one country per list OK, or do you need lists that mix countries?
  *SMS Edge: Upload Contacts › Import, Fixed Country or auto-detect.*
- **Duplicates on upload:** When uploading, should numbers already in another list be added again by default, or skipped?
  *Emily 35:06, both options are used.*
- **How often one person is texted:** What's the real rule: a minimum number of days between messages, a maximum per week?
  *Emily 36:05, lists sent "up to 40 times"; SMS Edge: contact reuse, account-wide by default.*
- **Flush:** Our flush resets a whole list so every number can be texted again. Is that how you use it, and who may do it?
  *Emily 35:39, flush "meaning restart it from zero".*

### Sending

- **Best route:** When you run a small test, what tells you a route is good enough to send more: a CTR level, sign-ups, something else? Do you know how SMS Edge's AutoSender decides, or do you use another tool for this?
  *SMS Edge: AutoSender "measures clicks & signups, then automatically scales out the best-performing message and route"; Meny 45:26, "if the CTR is good you keep sending another 200"; Emily 05:34. Sendex's AutoSender still uses guessed numbers (60 minutes, 5×, 80%) until this is answered.*
- **Test size and speed:** What test size do you usually use? Do carriers limit how fast we can send?
  *Emily 25:19, test size 100; Meny 45:26, 200; SMS Edge: Test Size defaults to 200.*

### Links and clicks

- **Link domains:** Which domains do you use for SMS links, who buys them, and do you use any tool to rotate them?
  *Emily 12:19, "Domains get picked randomly … .click, .sbs"; SMS Edge: "Casino + New Domain" and "Used Domain" text presets.*
- **Fake clicks:** What do you count as a fake click? Do carriers or phones open links automatically in the countries you send to?
  *Emily 11:28, previews and filtered clicks; SMS Edge: Previews column in the lap table.*

### Legal

- **Sending hours, opt-out, STOP:** Are there required sending hours per country? What opt-out wording? How must STOP replies be handled?
  *Emily 28:44, SMS Edge account settings have an "opt-out link"; SMS Edge: Opt-Out chip in ad texts.*

### Campaign table

- **Status:** Should drafts and stopped campaigns have their own status labels?
  *SMS Edge: a new campaign is Active straight away.*
- **Campaign ID:** Do you quote campaign numbers to clients or carriers? That decides whether we need a running number like SMS Edge's.
  *SMS Edge: campaign numbers like 243629, also inside event keys.*
- **Columns:** Which numbers do you need on each campaign row at a glance?
  *Emily 04:57, the rows she uses; SMS Edge: the campaigns table columns.*
- **Sorting:** Should the table sort by cost, sales or ROI? Show periods in one time zone?
  *SMS Edge: the Period column; Ours: no sorting, 25 a page.*
- **Filters:** What do you filter campaigns by day to day: brand, offer, sender ID, creator?
  *Emily 27:18, the filters she uses.*
- **Duplicate and delete:** When duplicating a campaign, copy the routes too? Should old campaigns be archived?
  *Emily 13:27, duplicate is used to resend.*
- **Who sees what:** Should managers see only their own campaigns, or at least who created each one?
  *Emily 09:29, Logs › Actions shows "who sent it from which user".*

### Accounts and providers

- **Roles:** Who in the team may send, top up, delete lists and campaigns, and see billing?
  *Emily 58:18, two SMS Edge accounts (internal and external); Ours: the roles in Sendex.*
- **SMS Edge for Monday (urgent):** Can we send through your SMS Edge account temporarily for Monday's presentation, and who pays for those messages?
  *Ours: the plan for Monday's demo.*
- **23Telecom:** Who chases 23Telecom for the IP unblock and SMPP details, and is SMPP still the plan?
  *Meny 1:04:54, "telecom is only one, we're going to bring many new different companies".*
- **Parked features:** Do you want the test-handset provider, the AI segment generator and custom-route sending, and when?
  *Emily 41:57, "testing we don't usually test from here"; SMS Edge: "+ Test SMS" and the AI Rule Generator.*

## Follow-ups for the build

- Long message toggle on ad texts, off by default (copied from SMS Edge).
- Campaign Sales counts first deposits only, to match SMS Edge's "Sales (FTD)".
- Keep AutoSender's guessed numbers until the "Best route" answer comes back; consider switching it off meanwhile.
