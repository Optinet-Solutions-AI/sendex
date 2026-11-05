# Backups and restore

Sendex's data lives in one Postgres database. Two layers protect it:

1. **The provider's own backups.** Supabase takes daily backups (and point-in-time recovery on
   the plans that include it). This is the first thing to reach for after a bad migration or a
   deleted table: restore from the Supabase dashboard.
2. **Our weekly logical dump to Cloudflare R2.** Independent of the provider, restorable
   anywhere Postgres 17 runs. This is the copy that survives losing the Supabase project
   itself, and the one we rehearse restoring.

## What runs

`.github/workflows/backup.yml` runs every Sunday at 03:00 UTC (and on demand from the Actions
tab). It installs the PostgreSQL 17 client and runs `scripts/backup/pg-backup.mjs`, which:

- runs `pg_dump --format=custom --no-owner --no-privileges` against `DATABASE_DIRECT_URL`
  (the direct connection, never the pooler);
- writes `sendex-<UTC timestamp>.dump` and prints its size and sha256 to the job log;
- uploads it to `r2://<R2_BACKUP_BUCKET>/postgres/` and deletes the oldest objects so eight
  weekly dumps remain (`BACKUP_KEEP`).

Secrets the workflow needs (GitHub, Settings, Secrets): `DATABASE_DIRECT_URL`,
`R2_ACCOUNT_ID`, `R2_BACKUP_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The R2 token
needs object read, write and delete on that one bucket only.

Without the `R2_*` variables the script keeps the local file only, which is how it is used on
a laptop.

## Restore

```
node scripts/backup/pg-restore.mjs --key postgres/sendex-20261108T030000Z.dump --target postgresql://user:pass@host:5432/sendex_restore
```

or with a file already on disk: `--file backups/sendex-....dump`. The target database must
exist; the restore drops and recreates every object in it (`--clean --if-exists`), then prints
row counts for organisations, lists, contacts, campaigns, laps, messages and ledger_entries so
they can be compared with the source.

Restore into a **new** database first (`sendex_restore`), check the counts and a few campaigns
in the app pointed at it, then switch `DATABASE_URL`. Never restore over the live database
while the worker is running: stop the worker, set the emergency stop, restore, start the
worker.

On Windows the client tools live in WSL; point the scripts at them:

```
PG_DUMP="wsl -d Ubuntu -- pg_dump" PG_RESTORE="wsl -d Ubuntu -- pg_restore" PSQL="wsl -d Ubuntu -- psql"
```

## Rehearsal log

| Date | Who | Source | Target | Result |
|------|-----|--------|--------|--------|
| 2026-11-07 | Christian (with Claude) | local `sendex` (seed + e2e data) | local `sendex_restore` | row counts identical, see the D3-13 PR |

Rehearse at least once a quarter and after every change to the schema that adds a table the
verify list does not know about (add it to `VERIFY_TABLES` in `pg-restore.mjs`).

## Objectives

- Recovery point: at most one week of data for the independent copy, at most one day (or
  minutes with PITR) through Supabase.
- Recovery time: under one hour for a restore into a fresh database and a `DATABASE_URL`
  switch. Messages already handed to the carrier are not lost: delivery receipts for them are
  rejected as unknown and logged, nothing is re-sent.
