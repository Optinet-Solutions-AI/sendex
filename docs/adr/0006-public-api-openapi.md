# ADR 0006: Public API as zod-openapi routes in the worker, with hashed scoped tokens

Date: 2026-11-06. Status: accepted.

## Context

Customers want to drive Sendex from their own systems: pull campaign results into a CRM, create campaigns from a tracker, trigger sends from a script. That needs a documented HTTP API with its own credentials, separate from the dashboard's Clerk sessions, and it must obey the same tenancy, validation and audit rules as the dashboard (AGENTS.md rules 4, 5 and 8). Only the worker talks to carriers and holds the sending engine's live counters (rule 10), and it already serves public HTTP (postbacks) on Hono with a rate limiter.

## Decision

- **The API lives in the worker**, as a Hono sub-app mounted next to `/health`, `/internal/*` and `/postback/:orgKey`, under `/api/v1`. The web app does not proxy it. Status answers come from the same Redis progress counters the dashboard reads.
- **Routes are `@hono/zod-openapi` definitions.** Request and response schemas are Zod schemas in `packages/core` (`api-tokens.ts`), reused by the validation, the TypeScript types and the generated OpenAPI 3.1 document at `/api/openapi.json`. The document is never hand-written. `@scalar/hono-api-reference` renders it at `/api/docs`.
- **Credentials are bearer tokens per organisation**: `sdx_` plus 32 random bytes, shown once, stored as a SHA-256 hash in `api_tokens`, with a display prefix, `last_used_at` and `revoked_at`. Owners create and revoke them under Settings → API tokens (permission `settings.manage`, recent sign-in required, audited as `api_token.create` / `api_token.revoke` without the token).
- **Scopes are a flat set** (`read`, `write`, `send`) checked by plain membership; no scope implies another, so a token can be given exactly what its system does.
- **Rate limit per token**, not per organisation: `RATE_LIMITS.publicApi` (600 / minute, sliding window in Redis) keyed by token id, with `RateLimit-*` and `Retry-After` headers, applied after authentication.
- **Reuse, not parallel logic.** Create goes through `createCampaign`; send goes through the same `estimateSend` and `createLaps` the dashboard's Send button uses, with the same Zod options (`routeIds`, `sendAll`), so the engine's contract has one implementation. Only successful create and send calls are audited; a `api.token_used` row per request would drown the log.
- **Versioning by path.** `/api/v1` only adds fields and enum values; a breaking change is `/api/v2`.

## Consequences

- One place to add an endpoint: a `createRoute` definition plus a handler, and the document, the types and the validation follow. Tests drive the app with `app.request()` against PGlite and a fake Redis.
- A leaked token is contained by its scopes and killed by revoke; nothing stored can be replayed. There is no token rotation or expiry in version one; those are additive.
- The worker's public origin (`WORKER_PUBLIC_URL`) is now customer-facing: it needs the same WAF and TLS as the postback endpoint (ADR 0004) and a stable hostname.
- `last_used_at` costs one small write per token per minute, chosen over exactness.
