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
