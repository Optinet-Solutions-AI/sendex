---
title: Local setup
description: Get the web app, worker and link service running on your machine in about ten minutes.
---

## Prerequisites

- Node 22 or newer.
- pnpm 10. Run `corepack enable` and the version pinned in the root `package.json` is used automatically.
- A Postgres database. The easiest is a free Supabase project; copy its pooled and direct connection strings.
- Redis. Any one of:
  - Docker: `docker run -p 6379:6379 redis:7`
  - WSL or Linux: `sudo apt install redis-server && redis-server`
  - An Upstash Redis URL.

## Steps

1. Clone the repository and open it in a terminal.
2. Copy the environment template and fill it in:

   ```sh
   cp .env.example .env
   ```

   Set `DATABASE_URL` (the Supabase pooled URL), `DATABASE_DIRECT_URL` (the direct URL, used by migrations) and `REDIS_URL`. `.env.example` documents every other key; the defaults are fine for local development.

3. Install everything:

   ```sh
   pnpm install
   ```

4. Create the schema and load demo data:

   ```sh
   pnpm db:migrate && pnpm db:seed
   ```

5. Start the three apps:

   ```sh
   pnpm dev
   ```

6. Open:
   - http://localhost:3000 for the web dashboard
   - http://localhost:4000/health for the worker
   - http://localhost:8787/health for the link service

## Daily commands

```
pnpm lint          Biome
pnpm typecheck     tsc --noEmit in every package
pnpm test          Vitest in every package
pnpm db:generate   drizzle-kit generate, after a schema change
pnpm db:migrate    apply migrations
```

All three must pass before a task is done. The pre-commit hook runs Biome on staged files, the typecheck, and a gitleaks scan; the commit-msg hook runs commitlint.

## Docs site

The site you are reading is `docs/`, a Starlight package in the same workspace:

```sh
pnpm --filter @sendex/docs dev
```

It serves on http://localhost:4321.

## Troubleshooting

- **`pnpm install` fails on `sharp`.** Starlight uses `sharp` for images; make sure you are on a supported Node version and retry. It needs no system libraries on Windows, macOS or glibc Linux.
- **Worker cannot connect to Redis.** Check `REDIS_URL` includes the scheme (`redis://` or `rediss://` for Upstash) and that the port is open.
- **Migrations fail with a pooler error.** Migrations must use `DATABASE_DIRECT_URL`, not the pooled URL.
