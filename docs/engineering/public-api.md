# Public API

Card D3-17. The worker serves a versioned HTTP API for an organisation's own systems: lists, campaigns, send and status, behind per-organisation bearer tokens. The OpenAPI document is generated from the route definitions and served at `/api/openapi.json`; a Scalar reference renders it at `/api/docs`. The user-facing page is [docs/using/api-tokens.md](../using/api-tokens.md); the decision record is [ADR 0005](../adr/0005-public-api-openapi.md).

```mermaid
sequenceDiagram
  participant C as Client
  participant W as Worker (OpenAPIHono)
  participant R as Redis
  participant DB as Postgres
  C->>W: GET /api/v1/campaigns  Authorization: Bearer sdx_…
  W->>W: sha-256(token)
  W->>DB: api_tokens by hash, revoked_at is null (touch last_used_at)
  alt no row
    W-->>C: 401 { error: "unauthorised" }  WWW-Authenticate: Bearer
  end
  W->>R: sliding window publicApi:<token id> (600 / minute)
  alt exhausted
    W-->>C: 429 { error: "rate_limited" }  RateLimit-* and Retry-After
  end
  W->>W: scope check (read / write / send) → 403
  W->>DB: query scoped by the token's organisation_id
  W-->>C: 200 JSON
```

## Where things are

| Piece | Path |
| --- | --- |
| Token helpers, scopes, request and response schemas | `packages/core/src/api-tokens.ts` |
| `api_tokens` table and migration `0005_api_tokens` | `packages/db/src/schema/api-tokens.ts`, `packages/db/drizzle/` |
| `createApiToken`, `listApiTokens`, `revokeApiToken`, `findApiTokenByHash` | `packages/db/src/queries/api-tokens.ts` |
| Auth middleware, serialisers, routes, document | `apps/worker/src/public-api/` |
| Wiring (`AppDeps.publicApi`) | `apps/worker/src/app.ts`, `apps/worker/src/index.ts` |
| Settings → API tokens page, actions, Playwright spec | `apps/web/app/(dashboard)/settings/api-tokens/`, `apps/web/e2e/api-tokens.spec.ts` |

## Tokens

A token is `sdx_` plus 32 random bytes as URL-safe base64 (47 characters), generated with Web Crypto in `packages/core` so the same code runs in the worker and in the Next.js app. Only its SHA-256 (hex) is stored, in `api_tokens.token_hash` (unique); the plaintext is returned once by `createApiToken` and shown once by the settings page. `prefix` (`sdx_` plus the first eight characters) is what the list shows so an owner can tell tokens apart.

Each row has `organisation_id` (the tenant everything the token does is scoped by), `name`, `scopes` (`text[]` of `read`, `write`, `send`), `created_by`, `created_at`, `last_used_at` (written at most once a minute per token) and `revoked_at`. Revoking sets `revoked_at`; `findApiTokenByHash` only returns rows where it is null, so the next call answers 401. Rows are never deleted: the settings page lists revoked tokens with their dates, and the audit log records `api_token.create` and `api_token.revoke` with the name and prefix, never the token.

Creating and revoking need the `settings.manage` permission (owners) and a recent sign-in (`assertRecentAuth`, as the postback secret rotation does).

## Scopes

`tokenHasScope` is plain membership: `send` does not imply `write`, `write` does not imply `read`. A system that only sends gets `send`; one that only reports gets `read`. A call whose scope the token lacks answers `403 { error: "forbidden", issues: "token lacks the send scope" }`. `GET /api/v1/me` needs no scope.

| Route | Scope | Backed by |
| --- | --- | --- |
| `GET /api/v1/me` | – | `getOrganisationById` |
| `GET /api/v1/lists` | read | `listLists` (50 per page; `search`, `country`) |
| `GET /api/v1/lists/{id}` | read | `getList` |
| `GET /api/v1/campaigns` | read | `listCampaigns` (25 per page; `search`, `country`, `status`) |
| `GET /api/v1/campaigns/{id}` | read | `getCampaign` plus lap counters summed |
| `GET /api/v1/campaigns/{id}/status` | read | `getCampaign` plus `ProgressTracker.readCampaign` (the live Redis counters the dashboard reads through `/internal/progress`) |
| `POST /api/v1/campaigns` | write | `apiCreateCampaignSchema` (the web form's `newCampaignSchema` with the timezone defaulting from the country) → `createCampaign`; audit `campaign.create` with `source: "api"` and the token id |
| `POST /api/v1/campaigns/{id}/send` | send | `apiSendCampaignSchema` (the web send form's `routeIds` and `sendAll`) → `estimateSend` then `createLaps`, which writes the `campaign.send` audit row itself; a second row `api.campaign.send` records the token. `createLaps`' refusals ("Pick at least one list", "Nothing to send", …) answer 422 |

Responses are JSON. Dates are ISO-8601 strings; `costMicro` and `revenueMicro` are decimal strings because int8 does not fit a JSON number. Validation failures answer `400 { error: "validation_failed", issues }` where `issues` is `z.prettifyError` of the Zod error.

## Rate limits

`RATE_LIMITS.publicApi` in `packages/redis-utils`: 600 calls per minute per token, a sliding window keyed `publicApi:<token id>` through the `rateLimit` Hono middleware (see [redis-utils.md](redis-utils.md)). Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`; a refused call answers `429 { error: "rate_limited", retryAfterMs }` with `Retry-After` in seconds. The limiter runs after authentication, so unauthenticated calls never consume anyone's window. Without Redis (`REDIS_URL` unset) the API is unthrottled, as the postback endpoint is.

## Document and reference

`createPublicApi` is an `OpenAPIHono` app; each route is a `createRoute` definition whose request and response schemas come from `packages/core`, so the document, the validation and the TypeScript types are the same thing. `app.doc31("/api/openapi.json", …)` serves OpenAPI 3.1 with a `bearerAuth` security scheme and `servers: [{ url: WORKER_PUBLIC_URL }]`; `Scalar({ url: "/api/openapi.json" })` serves the reference at `/api/docs`. Both are public: they describe the API, not any data.

## Versioning

Routes live under `/api/v1`. Within v1, fields are added but never removed or renamed, and enum values are added but never removed; anything else is a `/api/v2`. The document's `info.version` is the worker's `SENDEX_VERSION`.

## Running it locally

```sh
WORKER_PORT=4405 DATABASE_URL=postgresql://sendex:sendex@127.0.0.1:5432/sendex \
  REDIS_URL=redis://127.0.0.1:6379 INTERNAL_API_SECRET=dev pnpm --filter @sendex/worker dev
# create a token under http://localhost:3000/settings/api-tokens, then
curl -s http://localhost:4405/api/v1/me -H "Authorization: Bearer sdx_…"
open http://localhost:4405/api/docs
```

The web app's settings page reads `WORKER_PUBLIC_URL` to show the base URL and the link to `/api/docs`.

## Tests

- `packages/core/src/api-tokens.test.ts`: generation, hashing, bearer parsing, scopes, schemas.
- `packages/db/src/queries/api-tokens.test.ts` (PGlite): create returns the plaintext once, lookup by hash touches `last_used_at`, list never crosses organisations, revoke is idempotent and tenant-scoped.
- `apps/worker/src/public-api/routes.test.ts` (PGlite + `FakeRedis`, `app.request()`): the QA scenario (create a token, list campaigns → 200, revoke → 401), 403 on a missing scope, 429 with headers, lists, campaign create with audit, send with audit and status with live progress, 422 refusals, the document and the Scalar page.
- `apps/web/e2e/api-tokens.spec.ts` (Playwright): create → one-time reveal → revoke.
