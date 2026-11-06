# Runbook: deploying

Three deployables, three hosts. Nothing deploys until the accounts exist; the configuration is in the repo so the first deploy is a few commands.

## Web (Vercel)

1. Create a Vercel project from the GitHub repo. Root directory `apps/web`, framework Next.js. `apps/web/vercel.json` carries the install and build commands and security headers.
2. Environment variables (Preview and Production): `DATABASE_URL`, `DATABASE_DIRECT_URL`, `REDIS_URL` or the Upstash REST pair, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `WORKER_PUBLIC_URL`, `INTERNAL_API_SECRET`, `LINKS_BASE_URL`, `SENTRY_DSN`.
3. Every pull request gets a preview URL; `main` deploys production.
4. Set the function region next to the database (Settings, Functions): the dashboard runs several queries per page, so a region on another continent adds seconds.
5. The web app works before the worker exists. Until `WORKER_PUBLIC_URL` and `INTERNAL_API_SECRET` are set, Settings, Postbacks shows its URL templates with a `<worker-address>` placeholder and a "not deployed yet" notice, the API token dialog omits the docs link, and the emergency stop page reports the worker as not deployed (`apps/web/lib/worker-public-url.ts`). Outside production the fallback is `http://localhost:4000`.

## Worker (Fly.io)

1. `fly launch --no-deploy --copy-config --config apps/worker/fly.toml` from the repo root (app name `sendex-worker`). `primary_region` in `fly.toml` must be the database's region (`syd` while Supabase is in ap-southeast-2; `fra` once it moves): the send loop writes a ledger entry and a message row per SMS.
2. `fly ips allocate-v4` for a dedicated IPv4; give that address to 23Telecom for whitelisting.
3. `fly secrets set DATABASE_URL=... REDIS_URL=... INTERNAL_API_SECRET=... POSTBACK_SIGNING_SECRET=... WORKER_PUBLIC_URL=https://sendex-worker.fly.dev LINKS_BASE_URL=... SMPP_HOST=... SMPP_PORT=... SMPP_SYSTEM_ID=... SMPP_PASSWORD=...` (`INTERNAL_API_SECRET` is the same value the web app and the links service hold; leave the `SMPP_*` ones out until 23Telecom is live and the routes stay on the fake provider).
4. First deploy: `fly deploy --remote-only --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .` The build context is the repo root, so the root `.dockerignore` matters: it keeps `node_modules` (pnpm junctions on Windows break Fly's tar packer), `.env` and `.git` out of the context. The Dockerfile installs with `--ignore-scripts` because the root `prepare` script runs `lefthook install`, which needs git. The image runs `node apps/worker/dist/index.js`, an esbuild bundle (`apps/worker/scripts/build.mjs`) that inlines the workspace packages (they ship TypeScript sources) and keeps npm dependencies external; `apps/worker/src/build.test.ts` guards that no `@sendex/*` or `.ts` import survives. Check it locally without Docker: `pnpm --filter @sendex/worker build && node apps/worker/dist/index.js` with the `.env` values, then `curl localhost:4000/health`. A trial Fly account stops every machine after five minutes; add a card at https://fly.io/trial before relying on the worker.
5. Continuous deploys: add the repository secret `FLY_API_TOKEN` and the repository variable `FLY_DEPLOY_ENABLED=true`; `.github/workflows/deploy-worker.yml` then deploys on every merge to `main` that touches the worker or packages.
6. Scale to two machines for resilience once the SMPP leader lock (D2-16) is in: `fly scale count 2`.

## Links (Cloudflare Workers)

1. `wrangler login`, then `wrangler kv namespace create LINKS` and paste the ids into `apps/links/wrangler.toml`.
2. `pnpm --filter @sendex/links deploy`.
3. Add the short domains in Cloudflare DNS and route them to the Worker; enable managed WAF rules, bot fight mode and a rate-limit rule on `/*`.

## Rollback

- Vercel: Deployments, promote the previous one.
- Fly.io: `fly releases` then `fly deploy --image <previous image>` or `fly releases rollback`.
- Database: Supabase point-in-time restore, or restore the weekly dump from R2 (see backups runbook once D3-13 lands).
