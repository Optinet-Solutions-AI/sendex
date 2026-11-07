# SMS Edge parity: design

Date: 2026-11-07. Status: accepted. On 7 Nov Christian delegated every open decision to the builder; the answers are recorded under "Decisions taken" at the end. Source of requirements: the "SMS Edge Build Spec" (six screen recordings of app.smsedge.com/v2 read frame by frame, 7 Nov 2026). Decision from Christian on 7 Nov: everything in that spec is a must-have, including look, flows, table columns, hover states and animation.

## Intent

Sendex version one covered the five functions in Meny's brief and was demoed on 6 Nov with a real send to Malta and the Philippines. Side by side with SMS Edge it is visibly thinner: the shell, the tables, the campaign page and whole areas (segments, routes pages, reports, enrichment, unsubscribe) are missing or simplified. This design turns the spec into a build order so that a campaign manager who knows SMS Edge can sit in front of Sendex and find the same screens, the same words and the same behaviour.

## Goals

- Match SMS Edge screen for screen: the same pages at the same places in the navigation, the same columns, filters, dialogs, tooltips, empty states, loading states and validation messages.
- Keep Sendex's own foundations (tenancy, ledger, queues, providers, audit) untouched underneath; this is a product-surface build, not a rewrite.
- Keep every existing test green and add a test per new behaviour, as the repo rules require.

## Non-goals and anti-goals

- Not a pixel copy of SMS Edge's brand: the sigma logo, "Talk with Anna", Telegram and WhatsApp support links, "Back to classic view", the Email and AI Calls products stay out. Layout, components and behaviour are copied; brand and marketing text are ours.
- Not the parts the spec itself marks out of scope: API, AI Analyst, Settings, Email, AI Calls.
- Anti-goal: shipping screens that look right but read from nowhere. Every number on a new screen must come from our rows, the way the current campaign page does.

## Vocabulary (decision: adopt SMS Edge's words)

| Sendex today | Becomes | Why |
| --- | --- | --- |
| Links | Offers | The spec's word everywhere: offer form, offers performance, "0 active offers" |
| Sender ID group / sender ids | SID group / SIDs | Matches labels, dropdowns and the send bar |
| Ad texts | Ad texts (unchanged) | |
| Lap (unchanged) | Lap | |
| Results page | Analytics tab | |

## What exists today versus the spec

Effort is in agent-days: one agent working test-first with the user merging PRs. External means the feature needs a third-party service we do not have yet.

### A. App shell and visual language (2 days)

Today: a white 224 px sidebar with eight text links, a plain header with the organisation switcher, shadcn-style button, input, select, table, dialog, toast, badge, checkbox and a data table. No breadcrumbs, no tooltips, no skeletons, no page header pattern, no monospace numbers.

Spec: dark charcoal icon rail that expands on hover with submenus (Campaigns > Campaigns, Reports > Campaigns Log, Calendar, Postback Logs; Contacts > Lists, Segments, Enrichment, Unsubscribe; Routes > Platform, Custom, Testing, Mobile Networks); white top bar with the SMS product tab, "Search pages…" with Ctrl K, help, "Balance: €…", avatar; breadcrumb in grey capitals plus a bold title, optional subtitle and right-aligned outlined and navy buttons; light grey page, white cards with 1 px borders and 8–12 px radius; navy primary, red accent, green/amber/red status; monospace right-aligned numbers; sortable headers with ⇅ and ↓; the pagination formats; badges; dialogs whose primary is disabled until valid; pale green toasts; dark tooltips; empty states with an icon and a second line; skeleton loading; pill toggles; row action icons with hover colour; URL state for tabs; the period selector; the searchable country multi-select; the KPI strip.

Build: a `@sendex/ui` extension (rail, top bar, page header, kpi strip, period selector, country multi-select, tooltip, skeleton, toggle, icon button, pagination, sortable data table, dialog variants, empty state), tokens in `globals.css`, and every existing page moved onto them.

### B. Campaigns (4 days)

Today: list with filters, CSV export, duplicate and delete; new-campaign modal; campaign page with Status, Logs and Analytics tabs; panels for SIDs, lists, links, texts, routes, advanced; estimate footer; laps table with on/off switch and rank; pause, resume, stop, schedule; results tiles; messages are not listed.

Spec gaps: ID column, Active badge, flag plus country name, action tooltips, "Page 1 of 8 (187 total)", Filters toggle with date presets; new-campaign dialog with UI timezone and a disabled Create until named; header with KPI strip and Created line, pill tabs Status, Logs, Analytics, Send Single, "New Send" on sent campaigns; the two-column "Send this campaign" card with Send Now toggle and a context panel (Summary, Lists, Offers, Ad Texts, SIDs, Routes) that follows the form row; SID groups with "n/n active", sent and CTR stats, per-SID toggles, Add Sender IDs and New SID Group dialogs; list picker with segments and lists groups and "1,296 left"; Lists tab with progress bars, Sent "600 / 1,896", Unsub, Bad, per-list flush with tooltip; Offers form with existing-offer dropdown, token chips (Dynamic, Geo, Ad Text ID, List ID, Phone, First Name, Last Name, Email, Campaign ID, Campaign Name, Route Name, Custom 1–5, Offer ID, Cost Per Sending) and Advanced > Profit; Add Ad Texts dialog with `//` separation, insert chips, live counter "GSM_7BIT · n chars · n parts · n left", Check domain and Long message toggles; route picker with price or SMART range; Routes tab with platform ranks (daily, weekly, monthly) and account statistics; Advanced with Send All, Test Size, contact reuse cards, Run AutoSender; dark send bar with CONTACTS · SIDS · TEXTS · OFFERS · TEST SIZE · SMS · COST and the first validation message; Logs sub-tabs Messages, Actions, Ad Texts, Offers, SIDs in the URL; running campaign with Sending progress, laps header (country and local time, lap count, Custom, top-up buttons €5–€200 with the tooltip maths, Finish List, Sort by rank, Show comments, All toggle), lap columns Previews and Sending Period, lap menu Reschedule, Flush lap, Add comment; Delete Campaign dialog.

AutoSender (test batch, measure, scale the best message and route) is new logic in the worker: a scheduler step on top of laps. Previews means link-preview bot hits, which the links service already filters; they become a counted column.

### C. Lists and contacts (3 days)

Today: lists table with Name, Numbers, Country, Sent, Last sent, Last upload, Created and dashes for CTR, Leads, Sales, Spend; CSV upload with column mapping and the logical check that drops landlines, premium and toll-free numbers; flush; list page with four counts and a members table. No delete, no search, no bulk actions, no files page.

Spec gaps: real CTR, Leads, Sales and Spend per list; search; searchable country multi-select; bulk select with "n lists selected · Clear selection · Delete selected"; row "…" menu; "1 of 6" pagination; list details with KPI tiles (Total, Good, Cached, Sent, Clicks, CTR) and five tabs: Contacts (masked numbers, status filter, Good and Bad badges, "Showing 1 - 25 of 4,339"), Analytics (dimension chips Device Type, Country, Language, City, Verified Status with a grouped table), Data Files (drop zone, upload cards with per-reason summaries and Download CSV), Campaigns, Lookup (country breakdown with HLR, MNP, Unresolved, Local only, Checking, Bad, Blacklisted, and HLR Verify); Files page with import jobs, progress, actions and the expanded Import result and Duplicates; Upload Contacts with Upload Files (CSV, TXT, XLS, XLSX, several at once) and Paste CSV; the Bad status (landlines and suspicious patterns are kept and flagged, not dropped); "Found in another list"; delete and archive lists.

### D. Segments (4 days, plus 0.5 for the AI generator)

Today: nothing.

Spec: Segments list with All, Templates and Global Excludes tabs, search, Name with the plain-English summary, Size, Good, Flags, Created, edit, duplicate, delete, Refresh Stats with skeletons; the builder with an inline name, AI Rule Generator, Rules card with AND/OR, nested groups, Add Rule, Add Group, Remove group, red invalid rows and the amber problem banner, "Rule removed" toast, Global negative segment, live Preview (Total, Good, Cached and Sample, Countries, Networks, Devices); the field picker with groups List, Identity, Engagement, Recency, Campaign Activity, Voice, List (more), Identity (more), Engagement (more) including DLR fields, Recency (more), Device & Network (more), Enrichment (more) with "click data" tags; operators per field type; the edit page with description, Export CSV, Sample with re-sample, Segment Analytics with draggable dimension chips and Load Analytics; segments usable as campaign audiences; global excludes subtracted at send time; a "remove from list" option Emily asked for.

Segments are saved queries over contacts plus their send, click, DLR and conversion history, evaluated at send time. The AI generator calls the Claude API with the field catalogue and returns a rule tree.

### E. Routes (4 days, two parts external)

Today: routes live in the campaign's route picker and the seed; no routes pages.

Terms: a **platform route** is one Sendex rents and resells (the SMS Edge routes and 23Telecom today; `routes.organisation_id` is null, as in ADR 0007 and 0008). A **custom route** is a carrier connection a tenant brings themselves (SMPP or HTTP), stored under their organisation, used only by them.

Spec: Platform Routes page (filter bar, KPI strip Routes, Countries, Sent, Clicks, CTR, Total cost; Available Routes by country with prices; Delivery Report by country and route); Custom Routes (tenant-connected carriers) with the Routes tab (status eye, name and host, SMPP or HTTP badge, No pricing, Active), Edit, Pricing, Test Connection, Delete; Add Custom Route dialog for HTTP API with placeholders and headers, and SMPP; Routing Configuration with the three strategies and per-country exceptions; Stats with Sending Statistics, SMS Log and SMPP Connection History; Testing page with SMS Tests table, Send Single SMS dialog (country, recipient, routes, schedule days and 15-minute UTC slots, sender modes, text presets, hypothesis, jitter, cascade, cost estimate) and Test SMS; Mobile Networks with per-country operator cards, CTR delta, share of country, drill-down to routes, low-volume hiding.

External: Test SMS needs a test-handset network provider; Mobile Networks and the Lookup tab need the operator per number, which comes from an HLR or MNP lookup provider or from carrier receipts that carry it. Send Single, custom HTTP routes and routing strategies are ours to build.

### F. Reports and dashboard (4 days)

Today: a postbacks report and a thin dashboard.

Spec: Campaigns Log (period, country, KPI strip, one row per day × campaign × country × list × route, "(API / no campaign)", CPC to four decimals, Export CSV); Send Calendar (month KPIs, month grid with per-day totals and bars, up to three country lines, hover tooltip, day modal with campaigns and a total row, Week view); Postback Logs (event key `{campaignId}-{MMDD}-{clickId}`, Lead and Sale badges, filters, Reset, expandable row); Dashboard with Getting Started (KPI tiles, Start here, Common actions, Go further), Overview (Blended cost per sale, contacts uploaded and SMS sent per country over time with Month and Week), ROI pivot (row chips, Metrics menu, drill-down, Grand Total, cost per sale over time), Countries (utilisation map, unique signups and buyers, per-country table with Healthy and Under-worked, insight cards), Contacts (Lists and Segments cards, contacts versus sent, send-count distribution, good contacts not sent to with the threshold input), Assets (SMS Texts, Offers, Sender IDs performance tables with search), API Usage.

Most of this is read models over messages, clicks and conversions plus charts. A daily send statistics table (date, campaign, country, list, route) keeps the log and the calendar fast.

### G. Enrichment and unsubscribe (1.5 days plus HLR provider)

Today: nothing.

Spec: Unsubscribe page with KPI cells, Numbers, Imported lists and Unsubscribe API tabs, Add number, Upload unsubscribes (CSV, XLS, XLSX with a column picker), Resubscribe, and two API URLs (by dynamic id and by number); enforcement in the send loop account-wide. Numbers Verification with KPI strip, enrichment rules (country, daily limit, monthly budget, when to run, include archived), verification log, country network breakdown, verification coverage with the price per number.

Unsubscribe is ours. Verification needs an HLR or MNP provider; the rules, log and coverage screens can be built against the provider interface and FakeProvider first.

## Proposed order

1. A, shell and visual language, with every existing page moved onto it. First because it is what the user noticed first, and everything after sits on it.
2. B, campaigns, because it is the core loop and the demo surface.
3. C, lists and contacts, then G's unsubscribe half.
4. D, segments.
5. F, reports and dashboard.
6. E, routes, with the external parts stubbed behind the provider interface.
7. G's verification half, once an HLR provider is chosen.

Total about 24 agent-days of build plus the user's QA. Each phase ships as a series of PRs, one per screen or component group, each with tests and a docs page, on cards keyed D4-xx and up on the board.

## Decisions left to the user

1. The order above, or a different one.
2. Adopt the SMS Edge words (Offers, SIDs) in the UI, as proposed.
3. Approve looking for an HLR or MNP lookup provider and a test-handset provider, which both carry per-lookup cost.
4. Whether the AI rule generator may use the Claude API (needs an API key and a small monthly budget).
5. Lists with several countries: the spec's Lists page has a "Countries" column and a per-country breakdown, which means an SMS Edge list can hold numbers from several countries. Sendex lists and campaigns are one country each (the brief said "lists by country"). Proposed: keep one country per list, which keeps pricing and routing simple; the column shows it.
6. Custom routes: may tenants connect their own SMPP or HTTP carriers (Sendex then stores their credentials), and does Sendex charge a per-SMS platform fee on them as SMS Edge does (€0.01)? Proposed: yes to both, with the fee configurable per organisation and €0.01 as the default.

## What is left to the builder

Component internals, chart library choice (one library, loaded once), how the daily statistics table is maintained (trigger on message and click writes versus a nightly job; the builder should pick the trigger so the calendar is live), the exact masking of numbers in the Contacts tab (the spec shows `499916151****`), and migration naming.

## Builder check (7 Nov): settled decisions

A reviewer read this document as a builder would. The points below are settled here so the builder does not have to ask; the open ones are in "Decisions left to the user".

Rules of the repo, applied to the new screens:

- **Only the worker talks to carriers (rule 10).** Test Connection, Send Single, Test SMS and HLR Verify are buttons on pages, but each one enqueues a worker job and the page polls the job's row for the result. No page or server action calls a carrier or a lookup provider.
- **Every read scoped by organisation (rule 4), with one deliberate exception.** Platform routes are Sendex's own rows (`organisation_id` null) and are read through a dedicated `listPlatformRoutes` helper. Platform route rankings aggregate messages across all organisations on platform routes only, and are shown as anonymous ranks (1, 2, 3), never as another tenant's numbers. Custom routes and everything else stay tenant-scoped.
- **Money is a ledger (rule 6).** A lap "budget" is a cap: `laps.budget_micro`, raised by a top-up, which the send loop checks before each batch; debits stay per message as today. A per-SMS platform fee on custom routes is its own ledger entry per message, kind `fee`. Lookup and test-handset costs are ledger debits written by the job that performs them. A top-up above the organisation's balance is refused with the usual balance error.
- **Secrets (rule 7).** Custom route credentials are encrypted at rest with a key from the environment (`CUSTOM_ROUTE_SECRET_KEY`), decrypted only in the worker, never returned to a page; the edit dialog shows a masked value.

Schema additions the screens need (one migration per phase, additive only):

- `campaigns`: a per-organisation sequence `number` for the `#243817` style id; status badge maps draft, scheduled and sending to "Active", paused to "Paused", completed and stopped to "Done"; no new enum value.
- `laps`: `budget_micro`, `previews`, `comment`, `active` (the On switch today is derived; make it a column).
- `links` (shown as Offers): `profit_micro`; the table keeps its name, the UI says Offers.
- `contacts`: `custom1` to `custom5`.
- `lists`: stays one country per list (see the open decision); the "Countries" column shows that one country.
- Postback event key: the existing `dynamic_id` based contract stays; the Postback Logs page displays it as the event key.

Product calls made by the builder:

- Timezone in the new-campaign dialog: the country's capital-city zone, editable.
- Settings, Billing, Audit log and Scheduled: Settings and Billing stay under a Settings rail item; Audit log becomes Logs under Settings; Scheduled folds into Campaigns > Reports > Calendar.
- Segment Templates: an `is_template` flag with a "Save as template" action; templates are not selectable as an audience.
- Mobile Networks and Lookup without a lookup provider: operator comes from carrier receipts where present, otherwise "Unresolved".
- Roles: campaign managers do everything except billing, the audit log and route credentials; deleting lists or campaigns and Flush All Lists need the admin or owner role.
- Send bar validation order: SID group, audience, ad text, route, balance.
- AutoSender defaults: one lap of the campaign's test size per selected route; measure for 60 minutes or until every lap is done, whichever is later; "best" is the highest CTR with the lowest CPC as the tiebreak; scale out in laps of five times the test size on the best route while its CTR stays at or above 80 percent of its test value; stop when the list is finished or the CTR drops below that. Every value is a column on the campaign so the user can change it.
- Segment "remove from list" (Emily's request): a bulk action on a segment, "Remove matching contacts from their lists", with a confirmation that shows the count; never automatic.

## Decisions taken (7 Nov, by the builder under delegation)

1. Order: as proposed, A to G, with unsubscribe inside phase 3.
2. Vocabulary: SMS Edge's words in the UI (Offers, SIDs, Laps, Flush).
3. External providers: the lookup provider, the test-handset provider and the AI service are built behind interfaces with a fake implementation, the way carriers were; the real accounts are blockers listed for the user when the screens land.
4. Lists stay one country each.
5. Tenants may connect custom SMPP or HTTP routes; credentials encrypted at rest; a per-SMS platform fee, default €0.01, configurable per organisation in `organisation_settings`.
