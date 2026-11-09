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

The suite runs with one worker: every spec seeds rows in the same database and cleans up by
its own name or phone-number prefix (`e2e/helpers/db.ts`), so two specs running side by side
would see each other's rows. Do not leave a worker process running while the suite runs
either: its dispatcher sends the laps the campaign specs expect to stay queued.

### Phone width

`e2e/phone-width.spec.ts` opens the screens that overflowed in QA round two at 400 px and
checks that the page never scrolls sideways and the title and header buttons stay on screen.
Add a screen to its list when you build one. The usual causes, all found in that round:

- a flex or grid child that holds a table without `min-w-0`, so it grows to the table's width;
- a row of buttons or filters without `flex-wrap`;
- a `fieldset`, which does not shrink below its content unless given `min-w-0`;
- an absolutely placed element (an `sr-only` label) inside a scroll box that is not `relative`:
  the box does not clip it, so it stretches the page.

Menus inside a table row open in a `Popover` (portalled), not an absolute `div`: the
table's scroll box clips an inline menu, which is what hid Unarchive on a lone archived list.
Playwright scrolls a clipped menu into view and clicks it anyway, so those specs also assert
`toBeInViewport({ ratio: 1 })` before clicking.

### The full flow (D2-20)

`e2e/full-flow.spec.ts` is the one spec that uses the real engine. It starts the worker
itself (`e2e/helpers/worker.ts`: `pnpm --filter @sendex/worker exec tsx src/index.ts` on port
4300 with `LAP_POLL_MS=1000`, the FakeProvider behind the `platform` routes), cancels the
queued laps other specs left behind, builds a campaign on the screens (sender ids, the seeded
Spanish list, a text with `{{domain}}`, the "Rolling Slots" link, test size 20 on route 405),
sends it, reloads until the lap is `done`, checks the progress, the EUR 0.50 debit in the
header balance, then posts one click to `/internal/clicks` the way the links service does and
checks the lap's click count and the 5.00% CTR. It needs `REDIS_URL` as well as
`DATABASE_URL` and skips itself without them, so it runs locally and not on CI yet.

```sh
DATABASE_URL=postgresql://sendex:sendex@127.0.0.1:5432/sendex REDIS_URL=redis://127.0.0.1:6379 pnpm test:e2e
```
