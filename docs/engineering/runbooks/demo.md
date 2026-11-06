# Runbook: the Day 3 demo on one laptop

Thirty minutes, the five functions of the brief in the order Meny listed them, everything
running locally. Rehearse it once the day before; every step below has been run end to end by
`apps/web/e2e/full-flow.spec.ts`.

## Before the demo (15 minutes)

1. WSL services up: `wsl -d Ubuntu -u root -- systemctl start redis-server postgresql`. Keep a
   `wsl -d Ubuntu -- sleep infinity` window open so WSL does not idle out.
2. `.env` has `DATABASE_URL`, `REDIS_URL`, `SENDEX_DEV_AUTH=1`, `INTERNAL_API_SECRET` and
   `LAP_POLL_MS=1000`; `apps/links/.dev.vars` has the same `INTERNAL_API_SECRET`.
3. Fresh demo data: `DATABASE_URL=... pnpm db:seed` only if the database was wiped; otherwise
   open **Lists** and **Flush** the Spanish list `Roy Boy_ES_14092026_Batch2` so it shows 1,738
   available again.
4. No stray processes: nothing on ports 3000, 4000, 8787 (`Get-NetTCPConnection -LocalPort
   3000,4000,8787`), no old `tsx src/index.ts` worker.
5. `pnpm dev` from the repo root. Check http://localhost:3000 (dashboard, "Development login"
   banner), http://localhost:4000/health (`queues` all `true`), http://localhost:8787/health.
6. Open these tabs: Lists, Campaigns, Billing, Reports, Settings, and the user guide if the
   docs site runs (`pnpm --filter docs dev`).

## The script

| Minute | Brief point | Show | Say |
| --- | --- | --- | --- |
| 0-3 | Upload and manage lists by country | **Lists**: six seeded lists with country flags, counts and availability. **Upload**: paste ten Spanish numbers with a duplicate and a landline, pick ES, see the cleaning summary (kept, duplicates, dropped with reasons). Flush a list from the row menu. Export CSV. | Lists belong to one account only; numbers are normalised to E.164 and deduplicated on upload; a flush makes a list reusable without re-uploading. |
| 3-9 | Create campaigns: lists, sender ID, text with a link | **Campaigns**, **New Campaign** (name, ES, timezone follows the country). On the campaign page: sender ID group "ES Casino"; tick the Spanish list (footer shows 1,738 contacts); **Links**: attach "Rolling Slots"; **Add Texts**: `Gira y gana hoy en {{domain}}`, the counter shows one part; **Routes**: 405 at EUR 0.025; **Advanced**: test size 20; footer shows 20 SMS, EUR 0.50. | The footer is the send-count rule from the meeting: contacts x sender IDs x texts, capped by test size per route. `{{domain}}` becomes a short tracked link per message. |
| 9-13 | Send through integrated providers | **Send**. One lap queued on route 405; reload after two seconds: lap `done`, 20 / 20 sent, header balance down EUR 0.50. **Billing**: the 20 debits in Transactions. | The worker takes the lap from the queue, sends in batches through the provider adapter (today the test provider, tomorrow 23Telecom over SMPP, same code path), and debits the ledger per message with an idempotency key, so a retry never charges twice. |
| 13-18 | Schedule and manage sending | New campaign the same way but **Schedule** it for +3 minutes Madrid time; show it on **Campaigns, Scheduled**; change the time, cancel. On a sending campaign: **Pause**, **Resume**, **Stop** with its confirmation. **Settings, Emergency stop**: switch on (banner appears), switch off. **Settings, Billing**: daily message cap. | Pause parks the lap, stop cancels and refunds what was not sent; the emergency stop halts every account at once; the daily caps stop a mistake or a stolen login from emptying the balance. |
| 18-25 | Track sent, delivered, failed, clicks, registrations, sales | Back on the sent campaign: header tiles (sent, delivered, failed, clicks, CTR, cost, CPC, leads, CPL, sales, CPS), lap table, **Analytics** tab. Open a short link from a message in a new tab (http://localhost:8787/<code>): it redirects; reload the campaign: 1 click, 5.00% CTR. **Settings, Postbacks**: copy the signed registration URL, open it in a tab (dynamic id from the same message): **Reports, Postbacks** shows the lead, the campaign shows 1 lead and the CPL. | Clicks are captured at the edge and counted once per recipient; conversions arrive on a signed postback URL and are attributed to the message, so every lap shows cost per lead and per sale. Delivered and failed come from the carrier's receipts once 23Telecom is live. |
| 25-28 | Security and operations | **Audit log** (every action above is there), the security headers in the browser's network panel, the backup runbook, the partner API docs at http://localhost:4000/api/docs with a token from **Settings, API tokens**. | Every change is logged with who and when; the API lets a partner read campaigns and send with a scoped, revocable token. |
| 28-30 | What is next | The hosting accounts, the first real send through 23Telecom, Emily's feedback from the competitor demo. | Two days of accounts and go-live, then the adjustments. |

## If something goes wrong

- The lap stays queued: the worker is not running or `REDIS_URL` is wrong. Check
  http://localhost:4000/health; restart `pnpm dev`.
- The short link does not redirect: the links service has no `INTERNAL_API_SECRET`
  (`apps/links/.dev.vars`) or the worker is down; the click can still be shown through the
  Reports page by running `e2e/full-flow.spec.ts` beforehand.
- The footer shows 0 contacts: the list was sent to; flush it from the Lists page.
- Balance too low: **Billing, Fund**: record a manual deposit.
