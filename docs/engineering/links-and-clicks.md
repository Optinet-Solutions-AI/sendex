# Links and clicks

Every SMS carries a short link on a throwaway domain. `apps/links` (Hono on Cloudflare
Workers) serves the redirect and captures the click; the worker resolves codes it does not
know yet and stores the clicks. ADR 0003 explains why this runs at the edge.

Cards: D2-11 (redirect), D2-12 (click capture). Pure logic in `packages/core/src/links.ts`.

## Flow

```
phone  --GET /abcdefgh-->  apps/links (Cloudflare)
                             | isValidShortCode?            no  -> 404
                             | KV get code:abcdefgh         hit -> 302
                             | miss: GET worker /internal/links/abcdefgh (x-internal-secret)
                             |   200 -> KV put (30 days) -> 302        404 -> 404
                             | after the response (waitUntil), unless HEAD or a bot:
                             |   CLICKS queue bound?  yes -> queue.send(click)
                             |                        no  -> POST worker /internal/clicks {clicks:[click]}
apps/worker  POST /internal/clicks -> Zod -> BullMQ click-ingest -> createClickIngestHandler
                             -> messages by short_code -> insert clicks rows, laps.clicks += n
```

1. The send loop (D2-04) generates a code per message with `generateShortCode()` from
   `@sendex/core` (8 characters from `SHORT_CODE_ALPHABET`, which has no `0/O/1/l/I`), stores it
   in `messages.short_code` and puts `https://<link domain>/<code>` in the text.
2. The redirect validates the code, resolves it (KV, then the worker) and answers `302` with
   `cache-control: private, no-store`. Resolution is the only thing on the request path.
3. The click record is built from the request and handed off in `executionCtx.waitUntil()`, so
   the redirect never waits for the queue or the worker.
4. The worker validates the batch, queues a `click-ingest` job and the handler writes the rows.

## KV

Namespace binding `LINKS`. Key `code:<shortCode>`, value:

```json
{ "url": "https://dest.example/?d=dyn-42&g=ES", "organisationId": "...", "messageId": "...", "campaignId": "...", "lapId": "..." }
```

`url` is the final destination, placeholders already rendered. Entries are written on the first
miss with a 30 day TTL (`LINK_TTL_SECONDS`); a link edited after its first click keeps serving the
cached destination until then. To force re-resolution delete the key:
`wrangler kv key delete --binding LINKS code:<shortCode>`.

Without the binding (local `wrangler dev` before the namespace exists) every request goes to the
worker. The service still works, just slower.

## Placeholders

Link templates (`links.url`) may contain `{{dynamic}}`, `{{geo}}`, `{{campaign_id}}`,
`{{list_id}}`, `{{route_name}}`, `{{phone}}` and any custom `{{name}}`. `renderLinkUrl()` replaces
each with the URL-encoded value, and an unknown placeholder with the empty string, so the
destination stays a valid URL. Values come from the message (`dynamic_id`, `e164`), the campaign
(`country` as `geo`), the lap (`list_id`) and the route (`name`).

## Fallback: `GET /internal/links/:code`

Served by the worker (`createInternalLinksRoutes` in `apps/worker/src/links/internal-routes.ts`).
It looks the code up with `findShortCodeTarget()` (`packages/db/src/queries/clicks.ts`: message
joined to campaign, lap, route and the campaign's active link), renders the url and returns the KV
payload. `404` when the code is malformed, unknown, or the campaign has no active link. A campaign
with several active links resolves to the oldest; the message does not record which link its text
used (follow-up when multi-link campaigns land).

## Click record

```ts
{
  shortCode: "abcdefgh",
  clickedAt: "2026-11-06T10:00:00.000Z",   // when the redirect was served
  ip: "203.0.113.9",                       // cf-connecting-ip, else first x-forwarded-for, else "unknown"
  userAgent: "Mozilla/5.0 (iPhone; ...)",
  country: "ES",                           // request.cf.country, omitted when absent
  device: "mobile",                        // classifyDevice(userAgent): mobile | tablet | desktop | bot | unknown
  asn: "Vodafone Spain",                   // request.cf.asOrganization, omitted when absent
}
```

`shortCode`, `clickedAt`, `ip`, `userAgent` are the queue's `Click` (`apps/worker/src/jobs.ts`);
the rest is what the edge knows for free. Ingest stores `ip`, `country`, `userAgent`, `device`
and `asn` as `operator` on the `clicks` row; `"unknown"` and empty strings become null, a country
that is not two letters becomes null, and a missing `device` is classified on the worker.

### Not counted

- `HEAD /:code` (link previewers probe with it) is redirected and never recorded.
- A user agent that `classifyDevice()` calls a bot (crawlers, WhatsApp/Telegram/Facebook
  previewers, curl, python-requests, headless Chrome, ...) is redirected and not recorded.
- A click whose code matches no message is dropped at ingest (`unknown` in the handler log).

Delivery is at-least-once: a retried batch can insert a click twice. The dashboard reads
`laps.clicks`, which moves with the rows, so a duplicate inflates both consistently.

## Queue

With the `CLICKS` producer binding, each click is one message on the Cloudflare Queue
`sendex-clicks`. The same Worker is the consumer: `forwardClickBatch()` posts the whole batch to
`/internal/clicks` in one request, `ackAll()` on `2xx`, `retryAll()` otherwise. This is what
buffers clicks while the worker is down or deploying.

Without the binding the redirect posts each click directly (`{ clicks: [click] }`); the queue is
an optimisation, not a requirement. Both paths end in the BullMQ `click-ingest` queue.

## Internal routes

| Route | Body | Answers |
| --- | --- | --- |
| `GET /internal/links/:code` | none | `200` KV payload; `404` unknown, malformed or link-less; `401` bad secret |
| `POST /internal/clicks` | `{ clicks: ClickRecord[] }`, 1 to 1000 | `202 { accepted: n }`; `400` with the Zod issues; `503` queue unavailable; `401` bad secret |

Both require `x-internal-secret` equal to `INTERNAL_API_SECRET` (compared in constant time). An
empty secret refuses everything, so a missing variable cannot open the routes. They are mounted
on the worker's Hono app; the links service is their only client.

## Environment variables

Links service (`apps/links/wrangler.toml`):

| Name | Kind | Value |
| --- | --- | --- |
| `SENDEX_VERSION` | var | reported by `/health` |
| `WORKER_URL` | var | origin of apps/worker, e.g. `https://sendex-worker.fly.dev`; empty disables the fallback and the HTTP click path |
| `INTERNAL_API_SECRET` | secret | `wrangler secret put INTERNAL_API_SECRET`; same value as the worker |
| `LINKS` | KV binding | `wrangler kv namespace create LINKS` (and `--preview`), ids in `wrangler.toml` |
| `CLICKS` | queue producer | `wrangler queues create sendex-clicks`, then uncomment the two `queues` blocks |

Worker (`.env`, Fly.io secrets): `INTERNAL_API_SECRET`. The send loop uses `LINKS_BASE_URL` to
build the link in the text.

## Cloudflare setup

- **Domains.** Register the link domains (`.click`, `.sbs`, ...) in Cloudflare, DNS proxied, and
  attach each one to the `sendex-links` Worker as a custom domain (`wrangler.toml`:
  `routes = [{ pattern = "lnk.example", custom_domain = true }]`, or the dashboard). Rotating a
  burned domain is adding a new one and switching `LINKS_BASE_URL`; old codes keep resolving on
  every attached domain.
- **KV, queue, secret.** The three commands in the table above, then `pnpm --filter @sendex/links deploy`.
- **WAF.** Enable the Cloudflare managed ruleset and Bot Fight Mode on every link zone. Leave
  verified bots allowed: previewers are redirected but never counted, and blocking them breaks
  link previews in messaging apps. Optionally challenge countries no campaign targets.
- **Rate limit.** One rule per zone on `/*`: 20 requests per 10 seconds per IP, block for 10
  seconds. A phone clicks once; only scanners enumerating codes exceed it. The 8-character code
  space (57^8) makes enumeration pointless, the limit just keeps it cheap.
- **Health.** `GET /health` on any link domain answers `{ ok, version }`; put it on the uptime
  monitor. Workers analytics shows request counts and p50/p99; the redirect should stay well
  under 50 ms (one KV read on a hit).

## Wiring in the worker

Two lines in `apps/worker` (owned by D2-02; `app.ts` and `handlers.ts` are untouched by this card):

```ts
// app.ts: next to /health
app.route("/", createInternalLinksRoutes({ db: db(), secret: process.env.INTERNAL_API_SECRET ?? "", enqueueClicks: (batch) => queues.clickIngest.add("clicks", batch) }));
// handlers.ts
clickIngest: createClickIngestHandler(db()),
```

And extend `clickSchema` in `jobs.ts` with the optional `country`, `device` and `asn` strings, or
Zod strips them when the job is parsed off the queue (the handler then classifies the device from
the user agent and leaves country and operator null, so nothing breaks, but geo is lost).

## Tests

- `packages/core/src/links.test.ts`: alphabet, validation, deterministic generation, device
  classes, placeholder rendering.
- `apps/links/src/index.test.ts`, `clicks.test.ts`: `app.request()` with fake KV, queue and
  execution context and a stubbed `fetch`: hit, miss with fallback and caching, 404s, HEAD, bots,
  the queue consumer.
- `apps/worker/src/links/*.test.ts` and `packages/db/src/queries/clicks.test.ts`: PGlite with the
  real migrations: lookup, batch insert with the lap counter, the two routes and the auth.
