# Runbook: local setup

1. Node 22+ and pnpm 10 (`corepack enable && corepack prepare pnpm@10 --activate`).
2. `cp .env.example .env`. Fill `DATABASE_URL` and `DATABASE_DIRECT_URL` from Supabase (Project settings, Database, Connection string: use the *transaction* pooler URL on port 6543 for `DATABASE_URL` and the *session* pooler on 5432 for `DATABASE_DIRECT_URL`).
3. Redis: `docker compose up -d redis`, or in WSL `sudo apt install redis-server && redis-server --daemonize yes`, or an Upstash URL.
4. `pnpm install` (installs git hooks).
5. `pnpm db:migrate && pnpm db:seed`.
6. `pnpm dev`. Web http://localhost:3000, worker http://localhost:4000/health, links http://localhost:8787/health.

gitleaks runs on every commit. On Windows: `winget install Gitleaks.Gitleaks`, then open a new shell.

## Checks before you say a task is done

```
pnpm lint && pnpm typecheck && pnpm test
```
