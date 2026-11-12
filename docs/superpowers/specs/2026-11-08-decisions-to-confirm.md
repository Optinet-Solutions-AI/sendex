# Decisions to confirm with Meny and Alex

Date: 2026-11-08. Status: the Costs and the first three Leads and sales questions answered on 2026-11-10, every other question except 23Telecom on 2026-11-12 (answers below each question, quoted as written). Reviewed by Christian over three rounds in the local "Sendex Decisions to Confirm" page.

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
  **Answer (2026-11-10):** "We won't know how much to take; there's an approximate but not 100%. I think refund would make it more complicated, and based on deliverability we won't know exactly, because if someone's phone is off in the moment we won't get charged."
  *What Sendex does today:* it does not take an estimate up front. It charges each batch just before the batch goes out, and gives money back only for messages that never left (rejected by the carrier, or still waiting when the campaign was stopped or switched off). No change needed.
  *To confirm with Alex:* "if someone's phone is off we won't get charged" disagrees with the next answer and with 23Telecom's docs (only messages that never leave 23Telecom are free). If phone-off messages really are free, Sendex shows too much spend for undelivered messages.
- **Refunds:** SMS Edge gives money back on some messages. Exactly which ones: only unsent, or also undelivered? Does 23Telecom refund undelivered messages?
  *Emily 28:03, "campaigns that we usually get money back on"; Emily 30:40.*
  **Answer (2026-11-10):** "Only when an SMS is rejected do we not get charged for it." This matches 23Telecom's docs and what Sendex already does: rejected messages get their money back, undelivered ones stay charged.
- **Price changes:** When 23Telecom changes a price, how do we hear about it, and who updates it in Sendex?
  *Emily 41:30, SMS Edge prices "can change, but from their admin side"; Ours: Sendex keeps the price entered until someone changes it.*
  **Answer (2026-11-10):** "23Telecom should update us when prices change; not sure who needs to update this."
  *Still open:* who types the new price into Sendex. 23Telecom's API also lists prices with the previous rate and the kind of change, so Sendex could read them itself; only to build if Alex agrees.

### Leads and sales

- **Knowing about conversions:** How do we know when an SMS brought a conversion (a sign-up or a first deposit)? Where do you see it, and how does it get into SMS Edge?
  *Emily 08:20, the offer link's dynamic field "helps it connect with Tableau"; SMS Edge: offer URL `…?id={{{dynamic}}}`.*
  **Answer (2026-11-10):** "We have a connection to our reporting and postback with our links, so we see it in real time, maybe a few minutes' delay."
- **Postback URLs:** Do you use postback URLs to send sign-ups and deposits into SMS Edge? If yes, from which system?
  *SMS Edge: Reports › Postback Logs; Emily 32:57.*
  **Answer (2026-11-10):** "Yes. Alex can explain how this works; he sets it."
- **Leads and sales:** Are leads and sales set automatically by your tracking, or does someone tag them by hand? Does a sale always mean the first deposit (FTD)?
  *Emily 27:28, a filter for campaigns "that got an FTD"; SMS Edge: "Sales (FTD)".*
  **Answer (2026-11-10):** "This is tracked in the postback to make the difference. Alex can help."
  *Next:* ask Alex for an example postback, the value that tells a lead from a sale, and whether a sale is always the first deposit; then point his postbacks at Sendex (Settings › Postbacks) and check they land on the right campaign.
- **Late conversions:** Should Sendex count conversions that come weeks after the SMS, or leave those to Tableau?
  *Emily 08:29, late conversions are seen in Tableau.*
  **Answer (2026-11-12):** "it would be great to be able to see both same day and late conversions right now with sms edge we dont have that capability"
  *What it means for Sendex:* Sendex already counts a conversion however late it arrives; there is no cut-off.
  *Next:* Build: show same-day and late conversions separately in the reports (see item 17).
- **Who gets the credit:** If someone got texts from two campaigns and then signs up, which campaign gets the credit: the one whose link they used?
  *Ours: how Sendex credits a conversion today.*
  **Answer (2026-11-12):** "This wouldnt happen because each user gets one campaign a day the numbers dont overlap if maybe theres a mistake i would say it would show on both and we can see with the IP and click ID"
  *What it means for Sendex:* Matches Sendex: a conversion goes to the message whose link (click ID) was used, so two different links count separately.
- **Revenue:** Can the tracking system send amounts in other currencies? Should revenue be the player's deposit, or what we actually earn per player?
  *SMS Edge: Offers › Advanced › Profit (€), "revenue per conversion for ROI"; Emily 02:44 wants ROI.*
  **Answer (2026-11-12):** "this should be in uro dosent matter the players currencies - but also what do you mean can the tracking system send amounts in other currencies on what basis is this relevant"
  *What it means for Sendex:* Matches Sendex: every amount is read as EUR.
  *Next:* Explain: we asked because if the postback ever sent a payout in another currency (say USD), Sendex would have to convert it. Always EUR means nothing to build. Still open: should revenue be the player's deposit or what we earn per player?
- **Which day:** When a deposit comes days after the SMS, should reports put it on the day of the SMS or the day of the deposit?
  *Emily 08:29; Ours: Sendex books it on the day of the SMS.*
  **Answer (2026-11-12):** "i want it to show that they clicked a reg oon same day but deposit can show in the system when it was actually made so this will clear the same day vs late conversion because technically its coming from the same link if its not same link it will be counted seperatly"
  *What it means for Sendex:* Today Sendex puts both the lead and the sale on the day the SMS was sent.
  *Next:* Build: keep the sign-up on the SMS day and put the deposit on the day it was made. Together with item 12 this gives same-day and late conversions.

### Report formulas

- **Formulas:** Do you calculate cost per lead, cost per sale, CTR and ROI the same way in your sheets or Tableau?
  *Emily 05:34, CTR = clicks ÷ sent; Emily 02:44, cost per sale and per sign-up.*
  **Answer (2026-11-12):** "the cost is universial we have a cost per sms and that should inturn do the calculation in tableau"
  *What it means for Sendex:* Matches Sendex: cost is the price per SMS; the other figures are worked out from it.
- **Under-worked countries:** On the dashboard's Countries tab, we mark a country Under-worked when it has been sent to less than half its contacts. Is that how you judge it, or what do you look at?
  *SMS Edge: Countries tab utilisation map; Ours: the badge and the 50% line.*
  **Answer (2026-11-12):** "this is niot a section i use reffer to our dashboard - https://sms-edge.vercel.app/ there are many reasons a list is under used and that could be due to low engagment results sms edge i guess judges it based on used or not the logic for us is more accurate in the dashboard"
  *What it means for Sendex:* The Under-worked badge and its 50% line are our own invention, and the team does not use it.
  *Next:* Decide whether to keep the badge: the team judges under-use outside SMS Edge's Countries tab, so it may not be needed.

### Numbers and lists

- **Number cleaning:** Do you use anything besides Google's libphonenumber, or other software, to clean numbers before sending?
  *Emily 34:50, "the logical check means remove landlines and invalid numbers"; Ours: using libphonenumber.*
  **Answer (2026-11-12):** "Alex cleans the numbers before adding but we also have the HLR system that cleans and checks the numbers on a daily basis"
  *What it means for Sendex:* Sendex checks number format with libphonenumber. Alex's cleaning and the daily number check happen outside it.
  *Next:* Ask Alex what his cleaning removes, so Sendex does not undo or repeat it.
- **Suspicious numbers:** Should the system flag suspicious numbers automatically? What patterns do you know of?
  *SMS Edge: "Suspicious digit pattern (likely fake) — added as bad"; Ours: our exact patterns.*
  **Answer (2026-11-12):** "suspiscious numbers would be considered as what?"
  *What it means for Sendex:* Sendex marks some numbers Bad (never texted) by a rule we invented.
  *Next:* Explain: numbers that look made up, such as six identical digits in a row (+34 666 666 666), five zeros at the end, or a run like 1234567. Do you see numbers like that in your lists, and should they be skipped?
- **Number checks (HLR):** Which provider, which countries, and when? Is SMS Edge's number verification a separately paid service?
  *Emily 39:32, a daily limit and budget per country; SMS Edge: Contacts › Enrichment.*
  **Answer (2026-11-12):** "the number verification is inside sms edge the HLR is doing that inside and we pay ectra money for it - each country has a budget on a daily basis providers theres no control over"
  *What it means for Sendex:* Matches the Sendex screens (a daily budget per country), but Sendex has no number-check provider connected yet.
  *Next:* Choose a number-check (HLR) provider for Sendex. SMS Edge picks its own and gives no choice.
- **One country per list:** Is one country per list OK, or do you need lists that mix countries?
  *SMS Edge: Upload Contacts › Import, Fixed Country or auto-detect.*
  **Answer (2026-11-12):** "no one country per list"
  *What it means for Sendex:* Matches Sendex: one country per list.
- **Duplicates on upload:** When uploading, should numbers already in another list be added again by default, or skipped?
  *Emily 35:06, both options are used.*
  **Answer (2026-11-12):** "you have the option to remove duplicate numbers if they already exist in the system"
  *What it means for Sendex:* Sendex has both options on upload; the default is to allow duplicates.
  *Next:* Confirm which option should be the default; the answer does not say.
- **How often one person is texted:** What's the real rule: a minimum number of days between messages, a maximum per week?
  *Emily 36:05, lists sent "up to 40 times"; SMS Edge: contact reuse, account-wide by default.*
  **Answer (2026-11-12):** "usually every 3rd day we will send the list again, we change the content on a daily basis even if the offer stays the same"
  *What it means for Sendex:* Today a number is not texted again until its list is flushed.
  *Next:* Proposed: a setting to allow sending a list again after a number of days, 3 by default. Confirm before building.
- **Flush:** Our flush resets a whole list so every number can be texted again. Is that how you use it, and who may do it?
  *Emily 35:39, flush "meaning restart it from zero".*
  **Answer (2026-11-12):** "we can flush per campaign or account wide meaning we have a list we can use in a campaign use it all and then open another campaign and send all hte numbers again or for example send a campaign with half the numbers then open another campaign and be able to send all if its account wide the list will show that its been fully used and when opening a  new campaign we will need to flush the numbers"
  *What it means for Sendex:* Matches Sendex: contact reuse per campaign or account-wide, and Flush to reset.

### Sending

- **Best route:** When you run a small test, what tells you a route is good enough to send more: a CTR level, sign-ups, something else? Do you know how SMS Edge's AutoSender decides, or do you use another tool for this?
  *SMS Edge: AutoSender "measures clicks & signups, then automatically scales out the best-performing message and route"; Meny 45:26, "if the CTR is good you keep sending another 200"; Emily 05:34. Sendex's AutoSender still uses guessed numbers (60 minutes, 5×, 80%) until this is answered.*
  **Answer (2026-11-12):** "we dont really use auto sender but its based on ctr and clicks if we send a campaing 100 numbers we see ctr is growing we have 2,3,4,5 clicks we will send another batch of 200 we can test 5 routes send each 100 and see whats perfoming then delete the routes that brought in zero clicks"
  *What it means for Sendex:* Sendex's AutoSender still uses guessed numbers, and the team rarely uses one. Their way: 100 per route on 5 routes, drop routes with zero clicks, send 200 more on what works.
  *Next:* Keep AutoSender low priority. Possible small build: a button to remove the routes that brought zero clicks.
- **Test size and speed:** What test size do you usually use? Do carriers limit how fast we can send?
  *Emily 25:19, test size 100; Meny 45:26, 200; SMS Edge: Test Size defaults to 200.*
  **Answer (2026-11-12):** "we can test bettwen 50-200 approx the sending gets que'd we can send everything at once i understood for example france usually takes 1 hour from the point of schedualed and send to actually going live"
  *What it means for Sendex:* Fits Sendex: test size is chosen per campaign. The hour's delay in France happens after the message leaves us.

### Links and clicks

- **Link domains:** Which domains do you use for SMS links, who buys them, and do you use any tool to rotate them?
  *Emily 12:19, "Domains get picked randomly … .click, .sbs"; SMS Edge: "Casino + New Domain" and "Used Domain" text presets.*
  **Answer (2026-11-12):** "domains get chosen random from sms edge side and rotate randomly - i understood from techsms that we pay for these domains. from techsms side we can buy our inidividual domains and we we can use them as we choose. on SMS edge side we cannot choose its all random and if we want to test or change a domian sms edge tech team needs to do that for us when the campaign goes live"
  *What it means for Sendex:* Sendex links still run on a temporary workers.dev address.
  *Next:* Build: our own link domains that the team picks per campaign, like TechSMS. Decide who buys them.
- **Fake clicks:** What do you count as a fake click? Do carriers or phones open links automatically in the countries you send to?
  *Emily 11:28, previews and filtered clicks; SMS Edge: Previews column in the lap table.*
  **Answer (2026-11-12):** "fake click would be a bot click - no they do not auto open"
  *What it means for Sendex:* Matches Sendex: bot and preview opens are filtered out of clicks.

### Legal

- **Sending hours, opt-out, STOP:** Are there required sending hours per country? What opt-out wording? How must STOP replies be handled?
  *Emily 28:44, SMS Edge account settings have an "opt-out link"; SMS Edge: Opt-Out chip in ad texts.*
  **Answer (2026-11-12):** "you can add an unsubscribe link - we dont currently use this we have suggested sending hours if its outside suggested sending hours we usually get a yellow message not a pop up but its on the page that says its out of sending hours but sometimes this isnt relevant because maybe sending time us until 8pm local time but we can send at 9pm and performance is better its just a suggestion doesnt stop us from sending a campaign"
  *What it means for Sendex:* Sendex has no sending-hours notice. The opt-out link exists but is optional.
  *Next:* Build: a yellow, non-blocking 'outside suggested sending hours' notice per country. We need the suggested hours, for example from SMS Edge.

### Campaign table

- **Status:** Should drafts and stopped campaigns have their own status labels?
  *SMS Edge: a new campaign is Active straight away.*
  **Answer (2026-11-12):** "yes this would be helpful"
  *What it means for Sendex:* Today draft, scheduled and sending all show Active, and stopped and completed both show Done.
  *Next:* Build: separate Draft, Scheduled, Sending, Stopped and Completed labels.
- **Campaign ID:** Do you quote campaign numbers to clients or carriers? That decides whether we need a running number like SMS Edge's.
  *SMS Edge: campaign numbers like 243629, also inside event keys.*
  **Answer (2026-11-12):** "what does this mean?"
  *What it means for Sendex:* SMS Edge numbers campaigns (#243629); Sendex shows a short code (3f9a2c1b).
  *Next:* Explain: do you ever give a campaign number to someone outside the team, such as a partner or a carrier? If not, the short code stays.
- **Columns:** Which numbers do you need on each campaign row at a glance?
  *Emily 04:57, the rows she uses; SMS Edge: the campaigns table columns.*
  **Answer (2026-11-12):** "like statisticly speaking or number phones - phone we dont need thats inside the analytics regarding stats we have clikcs ctr reg sale cost"
  *What it means for Sendex:* Sendex rows already show clicks, CTR, leads (sign-ups), sales and cost.
- **Sorting:** Should the table sort by cost, sales or ROI? Show periods in one time zone?
  *SMS Edge: the Period column; Ours: no sorting, 25 a page.*
  **Answer (2026-11-12):** "i see on the campaign section my local time for when it was sent but the sending time should show in the countries local time and im abel to scheduale based on their time when i showed you how to open a campaign you can see we choose location and then we choose timezone if theres multiple locations - what table are you reffering to all these stats are releavnt to see"
  *What it means for Sendex:* Sendex schedules in the campaign's time zone and shows the period in it.
  *Next:* Explain: we meant the Campaigns list. Build: sortable columns, and every sent time shown in the country's local time.
- **Filters:** What do you filter campaigns by day to day: brand, offer, sender ID, creator?
  *Emily 27:18, the filters she uses.*
  **Answer (2026-11-12):** "i wannt to filter by all things possible creator less interesting but brand offer sender id, date, partner name location date engagment sales, lead, clicks everything"
  *What it means for Sendex:* Sendex filters by search, country, status, dates, has leads, has sales, no clicks and spend.
  *Next:* Build: filters for brand, offer, sender ID, partner, clicks, leads and sales.
- **Duplicate and delete:** When duplicating a campaign, copy the routes too? Should old campaigns be archived?
  *Emily 13:27, duplicate is used to resend.*
  **Answer (2026-11-12):** "when we duplicate a campaign i want everything to stay the same we will change it accordingly - we will need to change content and list maybe routes but maybe sometimes only the content will need to change so keep everything and we will change whats needed"
  *What it means for Sendex:* Today duplicate copies everything except the routes.
  *Next:* Build: duplicate copies the routes too.
- **Who sees what:** Should managers see only their own campaigns, or at least who created each one?
  *Emily 09:29, Logs › Actions shows "who sent it from which user".*
  **Answer (2026-11-12):** "they should see all campaigns"
  *What it means for Sendex:* Matches Sendex: everyone sees every campaign.

### Accounts and providers

- **Roles:** Who in the team may send, top up, delete lists and campaigns, and see billing?
  *Emily 58:18, two SMS Edge accounts (internal and external); Ours: the roles in Sendex.*
  **Answer (2026-11-12):** "currently we can all see everything i dont think this is an issue we can play with access and toggle on and off who has what permissions like facebook"
  *What it means for Sendex:* Sendex has fixed roles (owner, admin, campaign manager).
  *Next:* Build later: switch individual permissions on or off per person.
- **SMS Edge for Monday (urgent):** Can we send through your SMS Edge account temporarily for Monday's presentation, and who pays for those messages?
  *Ours: the plan for Monday's demo.*
  **Answer (2026-11-12):** "what does this mean?"
  *What it means for Sendex:* The question was about sending through SMS Edge for the demo on Monday 9 Nov, which has passed.
  *Next:* Drop it.
- **23Telecom:** Who chases 23Telecom for the IP unblock and SMPP details, and is SMPP still the plan?
  *Meny 1:04:54, "telecom is only one, we're going to bring many new different companies".*
- **Parked features:** Do you want the test-handset provider, the AI segment generator and custom-route sending, and when?
  *Emily 41:57, "testing we don't usually test from here"; SMS Edge: "+ Test SMS" and the AI Rule Generator.*
  **Answer (2026-11-12):** "what is the test handset provider , ai segment generator would be great and of course custom route sending i dont know when and im not 100% i answered this question correctly so please explain further"
  *What it means for Sendex:* Sendex already has the AI segment generator (Segments) and custom routes (Routes).
  *Next:* Explain: a test-handset provider is a paid service with real phones in each country that receive your test SMS, so you see exactly what arrives and how fast. Do you want one?

## Follow-ups for the build

- Long message toggle on ad texts, off by default (copied from SMS Edge).
- Campaign Sales counts first deposits only, to match SMS Edge's "Sales (FTD)".
- Ask Alex: whether messages to a phone that is off are charged; who updates prices in Sendex, and whether Sendex should read 23Telecom's prices itself; his postback setup (example, lead or sale value, FTD).
- From the 2026-11-12 answers, to build:
  - same-day and late conversions shown separately; the sign-up stays on the SMS day and the deposit goes on the day it was made (items 12 and 17);
  - separate Draft, Scheduled, Sending, Stopped and Completed labels (item 35);
  - duplicate copies the routes too (item 40);
  - sortable campaign columns, and sent times in the country's local time (item 38);
  - campaign filters for brand, offer, sender ID, partner, clicks, leads and sales (item 39);
  - our own link domains, chosen per campaign (item 32);
  - a yellow, non-blocking "outside suggested sending hours" notice per country (item 34);
  - later: permission switches per person (item 42); possibly a button to remove routes with zero clicks (item 27).
- To confirm before building: resending a list after a number of days, 3 by default (item 25); the default for duplicates on upload (item 24); whether to keep the Under-worked badge (item 19).
- To explain back: suspicious numbers (21), campaign numbers (36), the test-handset provider (45), why currency mattered (15). Item 43 (Monday's demo) is dropped; item 44 (23Telecom) is still unanswered.
- Keep AutoSender's guessed numbers until the "Best route" answer comes back; consider switching it off meanwhile.
