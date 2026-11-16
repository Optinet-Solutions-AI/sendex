import { execSync } from "node:child_process";
import { resolve } from "node:path";
import postgres from "postgres";

/** The repository root: this file is apps/web/e2e/helpers/demo.ts. */
const ROOT = resolve(__dirname, "..", "..", "..", "..");

/**
 * Make sure the demo activity (D5-02) is in the local database: the KPI specs read its lists,
 * offers and campaigns. Runs `pnpm db:seed:activity`, which changes nothing when the rows are
 * already there and refuses a database that is not on this machine.
 */
export function ensureDemoActivity(): void {
  execSync("pnpm db:seed:activity", { cwd: ROOT, stdio: "pipe", env: process.env });
}

/**
 * The month of the latest demo send. The demo sends are dated relative to the day they were
 * seeded, so a spec that looks at one month asks which month that is.
 */
export async function latestDemoMonth(): Promise<{ year: number; month: number }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the KPI e2e specs");
  const sql = postgres(url, { max: 1 });
  try {
    const [row] = await sql`
      select max(sent_at) as at from messages where idempotency_key like 'seed-activity:%'`;
    if (!row?.at) throw new Error("The demo activity is not seeded");
    const at = new Date(row.at as string);
    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
  } finally {
    await sql.end();
  }
}
