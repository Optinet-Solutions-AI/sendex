# Runbook: deploying

Three deployables, three hosts. Nothing deploys until the accounts exist; the configuration is in the repo so the first deploy is a few commands.

## Web (Vercel)

1. Create a Vercel project from the GitHub repo. Root directory `apps/web`, framework Next.js. `apps/web/vercel.json` carries the install and build commands and security headers.
2. Environment variables (Preview and Production): `DATABASE_URL`, `DATABASE_DIRECT_URL`, `REDIS_URL` or the Upstash REST pair, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `WORKER_PUBLIC_URL`, `LINKS_BASE_URL`, `SENTRY_DSN`.
3. Every pull request gets a preview URL; `main` deploys production.

## Worker (Fly.io)

1. `fly launch --no-deploy --copy-config --config apps/worker/fly.toml` from the repo root (app name `sendex-worker`, region `fra`).
2. `fly ips allocate-v4` for a dedicated IPv4; give that address to 23Telecom for whitelisting.
3. `fly secrets set DATABASE_URL=... REDIS_URL=... SMPP_HOST=... SMPP_PORT=... SMPP_SYSTEM_ID=... SMPP_PASSWORD=... POSTBACK_SIGNING_SECRET=... LINKS_INGEST_SECRET=...`
4. First deploy: `fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .`
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
