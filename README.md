# Sendex

Bulk SMS marketing platform modelled on SMS Edge: lists by country, campaigns with sender IDs and tracked links, sending through rented routes (23Telecom first), scheduling, and tracking of sent, delivered, failed, clicks, registrations and sales.

Monorepo: `apps/web` (Next.js dashboard), `apps/worker` (send loop, scheduler, public API), `apps/links` (click redirects on Cloudflare), `packages/*` (db, core, providers, ui). See `AGENTS.md` for conventions and the PMS board for the task list.

## Ten-minute setup

1. Install Node 22+ and pnpm 10 (`corepack enable`).
2. `cp .env.example .env` and fill in `DATABASE_URL` (Supabase pooled URL), `DATABASE_DIRECT_URL`, and `REDIS_URL`.
3. Redis locally: Docker (`docker run -p 6379:6379 redis:7`), WSL (`sudo apt install redis-server && redis-server`), or an Upstash URL.
4. `pnpm install`
5. `pnpm db:migrate && pnpm db:seed`
6. `pnpm dev` then open http://localhost:3000 (web), http://localhost:4000/health (worker), http://localhost:8787/health (links).

## Daily commands

```
pnpm lint        pnpm typecheck      pnpm test
pnpm db:generate (after schema changes)   pnpm db:migrate
```

## Branches and releases

Trunk-based. One branch per PMS card (`feat/d1-16-upload-ui`), draft PR early, squash merge to `main` with green checks. `main` deploys. Releases are tagged by release-please.
