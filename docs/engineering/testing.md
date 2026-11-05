# Testing

Two layers, both run locally and (unit tests today, e2e once the migrations land) in CI.
AGENTS.md rule 1 applies to both: write the failing test first.

## Unit tests (Vitest)

Every package has a `test` script running `vitest run`; `pnpm test` at the root runs them all
through Turbo. Tests live next to the code as `*.test.ts` / `*.test.tsx`.

- Pure logic (send counts, SMS encoding, permissions) lives in `packages/core` and is tested
  without any I/O.
- `apps/web/lib/*.test.ts` mock `@clerk/nextjs/server` and `@sendex/db` with `vi.mock` and an
  in-memory store, so nothing needs a database or a Clerk application.
- Environment-dependent code (`authMode()`, the dev auth stub) is tested with `vi.stubEnv`.

```sh
pnpm test                          # everything
pnpm --filter @sendex/web test     # one package
pnpm --filter @sendex/web exec vitest run lib/auth.test.ts   # one file
```

## End-to-end tests (Playwright)

`apps/web/e2e/*.spec.ts`, configured in `apps/web/playwright.config.ts`: Chromium only,
`baseURL` http://localhost:3000, one retry with a trace on the first retry in CI, and an HTML
report in `apps/web/playwright-report/` (git-ignored).

The config starts `pnpm dev` itself with `SENDEX_DEV_AUTH=1` and the Clerk keys blanked, so
the app runs under the development auth stub (see `auth.md`) and no Clerk session is needed.
It does need a Postgres with the core tables (`organisations`, `users`, `memberships`): point
`DATABASE_URL` at the local database from the setup runbook.

```sh
pnpm --filter @sendex/web test:e2e:install   # once: downloads Chromium
DATABASE_URL=postgresql://sendex:sendex@127.0.0.1:5432/sendex pnpm test:e2e
```

`pnpm test:e2e` at the root is `pnpm --filter @sendex/web test:e2e`. If a dev server is
already running on port 3000 it is reused outside CI; make sure it was started with
`SENDEX_DEV_AUTH=1`. When 3000 belongs to something else (another worktree's dev server, for
instance) set `PLAYWRIGHT_PORT=3100` (or `PORT`): the config then starts or reuses a server on that port. Open the report with
`pnpm --filter @sendex/web exec playwright show-report`.

Each new screen gets a spec covering its happy path (AGENTS.md, "Adding a screen"). The e2e
job is not in the CI workflow yet; it is wired in once the database migrations are on `main`.
