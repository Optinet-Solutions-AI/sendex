import postgres from "postgres";

/**
 * Direct database cleanup for the e2e specs. Deletes the lists whose name starts with
 * `namePrefix` (members cascade) and the contacts whose number starts with `e164Prefix`,
 * so an upload spec can run again and again against the same seeded database. Test-only:
 * application code never runs raw SQL (AGENTS.md rule 4).
 */
export async function cleanupE2eLists(namePrefix: string, e164Prefix: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the lists e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from lists where name like ${`${namePrefix}%`}`;
    await sql`delete from contacts where e164 like ${`${e164Prefix}%`}`;
  } finally {
    await sql.end();
  }
}

/**
 * Reset the sending progress of a seeded list so a campaign spec sees the full list again,
 * no matter what the engine sent earlier. Mirrors the app's flush (list_members.sent_at
 * cleared, flushed_at stamped) and leaves messages and ledger rows untouched.
 */
export async function flushListByName(name: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the campaigns e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`update list_members set sent_at = null, flushed_at = now()
      where list_id in (select id from lists where name = ${name})`;
  } finally {
    await sql.end();
  }
}
