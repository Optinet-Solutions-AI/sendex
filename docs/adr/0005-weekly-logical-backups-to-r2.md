# ADR 0005: weekly logical backups to R2 next to the provider's backups

Status: accepted, 2026-11-07

## Context

The database is hosted (Supabase Postgres). The host takes its own backups, but they live
inside the same account that a lost password, a billing lapse or an account compromise would
take away. The brief asks for a rehearsed restore, which needs a copy we fully control.

## Decision

A GitHub Actions job runs `pg_dump` in custom format every Sunday and uploads it to a
Cloudflare R2 bucket (S3 API, no egress fees), keeping the last eight. A restore script
downloads a dump, restores it into a named database and prints row counts for verification.
The restore is rehearsed quarterly into a throwaway database and logged in the runbook.

## Consequences

- One more set of secrets in GitHub (direct database URL, R2 token scoped to one bucket).
- Dumps contain phone numbers: the bucket is private, the token is bucket-scoped, and the
  retention is short (eight weeks). Encryption at rest is R2's default.
- Point-in-time recovery stays the host's job; our copy is the disaster copy, not the
  undo button.
