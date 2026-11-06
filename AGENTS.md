# Sendex: instructions for coding agents

Sendex is a bulk SMS marketing platform modelled on SMS Edge. It owns lists, campaigns, scheduling, click tracking, conversion tracking and billing, and rents SMS routes from providers (first: 23Telecom over SMPP). Version one is the five functions in the brief: upload lists by country, create campaigns (lists + sender ID + text with a tracked link), send through providers, schedule and manage sending, track sent / delivered / failed / clicks / registrations / sales.

Planning docs (read when a decision is unclear): meeting analysis, tech stack, first-version plan. Links are in the PMS project description. The PMS board (Sendex project) is the task list: every card is keyed `D1-xx`, `D2-xx`, `D3-xx` and names its branch.

## Layout

```
apps/web        Next.js (App Router) dashboard, server actions + tRPC for internal calls. Deploys to Vercel.
apps/worker     Node service: BullMQ send loop, scheduler, provider adapters, public API (Hono + zod-openapi), postbacks. Deploys to Fly.io.
apps/links      Hono on Cloudflare Workers: short link redirect + click capture.
packages/db     Drizzle schema, migrations, seed. Postgres on Supabase.
packages/core   Pure logic: send-count maths, GSM/UCS-2 counting, lap planning, ledger rules, Zod schemas. No I/O.
packages/providers  Provider interface + SmppProvider, HttpProvider, FakeProvider.
packages/ui     Shared shadcn components and chart wrappers.
docs/           Starlight docs site, ADRs in docs/adr.
```

## Commands

```
pnpm install            install everything
pnpm dev                run web (3000), worker (4000), links (8787)
pnpm lint / lint:fix    Biome
pnpm typecheck          tsc --noEmit in every package
pnpm test               Vitest in every package
pnpm db:generate        drizzle-kit generate (after schema changes)
pnpm db:migrate         apply migrations
pnpm db:seed            demo organisations and data
pnpm --filter @sendex/db erd   regenerate docs/engineering/erd.md after schema changes (CI checks it)
```

## Rules

1. **Test first.** Write the failing Vitest (or Playwright) test, watch it fail, then write the code. Pure logic lives in `packages/core` so it is testable without I/O.
2. **One branch per PMS card**, named after the card: `feat/d1-16-upload-ui`, `fix/…`, `chore/…`, `docs/…`, `test/…`. Open a draft PR early. Squash merge to `main` only through a PR with green checks. Never push to `main`.
3. **Conventional commits**: `feat(web): list upload page (D1-16)`. Put the card key in the subject.
4. **Tenancy everywhere.** Every tenant table has `organisation_id`. All reads and writes go through `packages/db` helpers that take the organisation id; never a raw query from a page or route.
5. **Validate at the boundary.** Zod schemas from `packages/core` on every form, server action, API route and queue payload.
6. **Money is a ledger.** Balance is the sum of `ledger_entries`; never update a balance column. Every send writes its debit in the same transaction, with an idempotency key.
7. **Secrets** only in `.env` (git-ignored), Vercel, Fly.io or GitHub secrets. `.env.example` documents every key. gitleaks runs on commit.
8. **Docs in the same PR.** A feature PR updates its how-to page under `docs/` and adds an ADR when it makes an architectural choice.
9. **Biome, strict TypeScript, no `any`, no non-null assertions.** `pnpm lint && pnpm typecheck && pnpm test` must pass before you say a task is done.
10. **Do not** add Prisma, ESLint, Prettier, Express, or a second ORM/queue/auth library. Do not call providers from the web app; only the worker talks to carriers.

## Adding a provider

Implement `Provider` from `packages/providers` (send, parseDeliveryReceipt, priceFor, validateSenderId), register it in the provider registry, add a route row with its prices, add an integration test against `FakeProvider`-style injected failures, and a runbook page under `docs/engineering/providers/`.

## Adding a screen

Server component page under `apps/web/app/(dashboard)/…`, data via a `packages/db` helper scoped by organisation, mutations via a server action validated with Zod, a Playwright spec covering the happy path, and a docs page.
