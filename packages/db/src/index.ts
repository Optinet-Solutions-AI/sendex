import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export * from "./queries/api-tokens.js";
export * from "./queries/audit.js";
export * from "./queries/campaigns.js";
export * from "./queries/clicks.js";
export * from "./queries/ledger.js";
export * from "./queries/lists.js";
export * from "./queries/sending.js";
export * from "./queries/settings.js";
export * from "./queries/tenancy.js";
export * from "./schema/index.js";
export type { Db } from "./types.js";
export { schema };

export type Database = ReturnType<typeof createDb>;

/**
 * Create a database client. `DATABASE_URL` should be the pooled (PgBouncer / Supavisor)
 * URL in transaction mode; `prepare: false` is required for that mode.
 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false, max: 10, idle_timeout: 20 });
  return drizzle(client, { schema });
}

let shared: Database | undefined;

/** Lazily-created shared client for server code. Tests create their own. */
export function db(): Database {
  shared ??= createDb();
  return shared;
}
export * from "./queries/postback-keys.js";
export * from "./queries/postbacks.js";
