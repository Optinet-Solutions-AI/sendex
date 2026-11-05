# ADR 0004: Security and resilience are part of version one

Date: 2026-11-06. Status: accepted.

## Context

The platform moves money (a prepaid balance) and sends messages to the public under the customer's sender names. A compromised account or an unprotected endpoint can empty a balance or damage a route's reputation in minutes.

## Decision

The following are built in version one, not deferred:

- Clerk login with organisations as tenants, 2FA required for owners, server-side role checks (`can()` in `packages/core`), re-authentication for emergency stop, balance and role changes.
- `organisation_id` on every tenant table, enforced by a test, and every query through `packages/db` helpers that take the organisation id.
- Rate limits (Upstash Ratelimit) on login, uploads, sends, the public API and postbacks; Cloudflare WAF in front of links and the worker; Vercel firewall for the web app.
- Signed postback URLs, Stripe signature verification, replay protection by event key.
- An append-only ledger with idempotency keys; balance is a sum.
- An audit log of sends, stops, schedule changes, balance changes, logins and role changes.
- Per-organisation sending and spend caps with spike alerts.
- Two worker machines with health checks; one holds each carrier bind under a Redis leader lock.
- Secrets only in Vercel, Fly.io and GitHub stores; gitleaks on commit and in CI; Dependabot and `pnpm audit`.
- Backups: Supabase point-in-time restore plus a weekly encrypted dump to R2, with one rehearsed restore.

## Consequences

Each item is a PMS card or subtask in the three-day plan; none is a later phase.
