import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema/index.js";

/**
 * Any Drizzle Postgres handle with the Sendex schema: the postgres-js client in
 * production, PGlite in tests, or a transaction of either. Query helpers and
 * the seed take this so they work against all three.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
