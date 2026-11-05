---
title: "0005: Public API as zod-openapi routes in the worker"
description: Where the public API lives, how it is documented, and how its tokens, scopes and rate limits work.
sidebar:
  order: 5
---

Date: 2026-11-06. Status: accepted. Source record: `docs/adr/0005-public-api-openapi.md`.

## Context

Customers want to drive Sendex from their own systems: pull campaign results into a CRM, create campaigns from a tracker, trigger sends from a script. That needs a documented HTTP API with its own credentials, separate from the dashboard's Clerk sessions, and it must obey the same tenancy, validation and audit rules as the dashboard. Only the worker talks to carriers and holds the sending engine's live counters, and it already serves public HTTP (postbacks) on Hono with a rate limiter.

## Decision

- **The API lives in the worker**, as a Hono sub-app mounted next to `/health`, `/internal/*` and `/postback/:orgKey`, under `/api/v1`. The web app does not proxy it. Status answers come from the same Redis progress counters the dashboard reads.
- **Routes are `@hono/zod-openapi` definitions.** Request and response schemas are Zod schemas in `packages/core`, reused by the validation, the TypeScript types and the generated OpenAPI 3.1 document at `/api/openapi.json`. The document is never hand-written. `@scalar/hono-api-reference` renders it at `/api/docs`.
- **Credentials are bearer tokens per organisation**: `sdx_` plus 32 random bytes, shown once, stored as a SHA-256 hash in `api_tokens`, with a display prefix, `last_used_at` and `revoked_at`. Owners create and revoke them under Settings → API tokens (permission `settings.manage`, recent sign-in required, audited without the token).
- **Scopes are a flat set** (`read`, `write`, `send`) checked by plain membership; no scope implies another.
- **Rate limit per token**, not per organisation: 600 calls a minute in a sliding window keyed by token id, with `RateLimit-*` and `Retry-After` headers, applied after authentication.
- **Reuse, not parallel logic.** Create goes through `createCampaign`; send goes through the same `estimateSend` and `createLaps` the dashboard's Send button uses, with the same Zod options. Only successful create and send calls are audited.
- **Versioning by path.** `/api/v1` only adds fields and enum values; a breaking change is `/api/v2`.

## Consequences

- One place to add an endpoint: a route definition plus a handler, and the document, the types and the validation follow. Tests drive the app with `app.request()` against PGlite and a fake Redis.
- A leaked token is contained by its scopes and killed by revoke; nothing stored can be replayed. No token rotation or expiry in version one; those are additive.
- The worker's public origin is now customer-facing: it needs the same WAF and TLS as the postback endpoint and a stable hostname.
- `last_used_at` costs one small write per token per minute, chosen over exactness.
