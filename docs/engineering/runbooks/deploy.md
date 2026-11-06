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
2. `fly ips allocate-egress -a sendex-worker --region syd` for a static **outbound** IPv4; give that address to 23Telecom for whitelisting (allocated 2026-11-06: `209.71.97.132`). A dedicated ingress IPv4 (`fly ips allocate-v4`) is for inbound traffic only and does not fix the worker's source address. Egress IPs are per region: re-allocate when the app moves to `fra`.
3. `fly secrets set DATABASE_URL=... REDIS_URL=... INTERNAL_API_SECRET=... POSTBACK_SIGNING_SECRET=... WORKER_PUBLIC_URL=https://sendex-worker.fly.dev LINKS_BASE_URL=... TELECOM23_API_KEY=... TELECOM23_WEBHOOK_SECRET=... SMPP_HOST=... SMPP_PORT=... SMPP_SYSTEM_ID=... SMPP_PASSWORD=...` (`INTERNAL_API_SECRET` is the same value the web app and the links service hold; `TELECOM23_*` registers the `23telecom` REST provider, see [providers/23telecom.md](../providers/23telecom.md); leave the `SMPP_*` ones out until the SMPP account is live).
4. First deploy: `fly deploy --remote-only --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .` The build context is the repo root, so the root `.dockerignore` matters: it keeps `node_modules` (pnpm junctions on Windows break Fly's tar packer), `.env` and `.git` out of the context. The Dockerfile installs with `--ignore-scripts` because the root `prepare` script runs `lefthook install`, which needs git. The image runs `node apps/worker/dist/index.js`, an esbuild bundle (`apps/worker/scripts/build.mjs`) that inlines the workspace packages (they ship TypeScript sources) and keeps npm dependencies external; `apps/worker/src/build.test.ts` guards that no `@sendex/*` or `.ts` import survives. Check it locally without Docker: `pnpm --filter @sendex/worker build && node apps/worker/dist/index.js` with the `.env` values, then `curl localhost:4000/health`. A trial Fly account stops every machine after five minutes; add a card at https://fly.io/trial before relying on the worker.
5. Continuous deploys: add the repository secret `FLY_API_TOKEN` and the repository variable `FLY_DEPLOY_ENABLED=true`; `.github/workflows/deploy-worker.yml` then deploys on every merge to `main` that touches the worker or packages.
6. Scale to two machines for resilience once the SMPP leader lock (D2-16) is in: `fly scale count 2`.

## Links (Cloudflare Workers)

1. `wrangler login`, then `wrangler kv namespace create LINKS` and paste the ids into `apps/links/wrangler.toml`.
2. `pnpm --filter @sendex/links deploy`.
3. Add the short domains in Cloudflare DNS and route them to the Worker; enable managed WAF rules, bot fight mode and a rate-limit rule on `/*`.

## Redis (Upstash)

The worker's queues, the emergency stop flag, rate limiters and progress counters live in one Upstash Redis database (`sendex`, region ap-southeast-2, `REDIS_URL` on Fly). Upstash bills per command below its fixed plans and the **free plan stops answering after 500K commands per month**: on 2026-11-06 the worker reached that after about five hours (`ERR max requests limit exceeded` on every queue, no lap could run). The database must be on a **Fixed plan (250MB, $10/month, unlimited commands)**, or pay-as-you-go with a budget cap as a stopgap.

What costs commands when nothing is being sent, and the knobs (D3-23):

- Idle BullMQ workers block for `DRAIN_DELAY_SECONDS` (30) per poll; a new job wakes them at once, so a longer wait costs no latency.
- The lap dispatcher repeat job runs every `LAP_POLL_MS` (5 s), about a dozen commands per run; raising it delays when a sent campaign starts.
- `/health` is probed by Fly every 15 s; queue depths are cached for `QUEUE_DEPTH_CACHE_MS` (60 s) so a probe is one `PING` most of the time.
- Expect well under five commands per second with no traffic (Upstash console, Usage). A sudden climb usually means a worker stuck in a retry loop: check `fly logs` for repeated `job failed`.

## Releases (D3-19)

Versions come from conventional commits through [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release-please.yml`, `release-please-config.json`, `.release-please-manifest.json`):

1. Every push to `main` refreshes the open "chore(main): release X.Y.Z" pull request: `CHANGELOG.md` from the `feat`/`fix`/`perf`/`docs` subjects since the last tag, and the version in the root and app `package.json` files. Before 1.0 a `feat` bumps the minor, a `fix` the patch.
2. Merging that pull request tags `vX.Y.Z` and publishes the GitHub release. The tag commit touches `package.json`, so the worker and links deploys run from it; Vercel builds it like any push to `main`.
3. The version shows in the footer of the dashboard rail (`NEXT_PUBLIC_SENDEX_VERSION`, read from `package.json` at build time), in the worker's `/health` (`SENDEX_VERSION`, passed as a Docker build argument by the deploy workflow) and in the GitHub release.

One-time setup: the release pull request must get a CI run, and pull requests opened with the default `GITHUB_TOKEN` never trigger workflows. Add the repository secret `RELEASE_PLEASE_TOKEN`, a fine-grained personal access token for this repository with Contents and Pull requests set to write; the workflow falls back to `GITHUB_TOKEN` when it is missing, and the release PR then needs a manual empty commit (`git commit --allow-empty`) to get its checks. Links deploys also need `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, Workers KV Storage: Edit), `CLOUDFLARE_ACCOUNT_ID` and the variable `CF_DEPLOY_ENABLED=true` (`.github/workflows/deploy-links.yml`), mirroring the worker's `FLY_API_TOKEN` and `FLY_DEPLOY_ENABLED`.

## Rollback

- Vercel: Deployments, open the previous production deployment, "Instant Rollback" (or `vercel rollback <deployment-url>` with the CLI). Environment variables are not part of a deployment: a rollback keeps the current ones.
- Fly.io: `fly releases -a sendex-worker` lists versions with their image; `fly deploy -a sendex-worker --image <image of the previous release>` redeploys it (the image stays in the Fly registry). Secrets are not part of a release either. `fly releases rollback` is not available on machines apps.
- Links: `wrangler rollback` from `apps/links` (Cloudflare keeps the last ten versions), or `wrangler versions list` and `wrangler versions deploy`.
- Database: migrations are forward-only; a release whose migration must be undone needs a down migration in a hotfix. Data: Supabase point-in-time restore, or the weekly dump from R2 (backups runbook).
- Order for a bad release: roll the web app back first (users see it), then the worker, then links; a worker on the previous version works with a newer schema as long as the migration only added columns, which is the rule.
