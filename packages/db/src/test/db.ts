import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../schema/index.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  close: () => Promise<void>;
}

/**
 * In-memory Postgres (PGlite) with every migration from `packages/db/drizzle` applied.
 * Each call is a fresh, isolated database; call `close()` in `afterAll`.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}

function messageChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" <- ");
}

/** Assert that a query is rejected by a Postgres unique constraint (SQLSTATE 23505). */
export async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (caught === undefined) throw new Error("expected a unique violation, but the query succeeded");
  const text = messageChain(caught);
  if (!/duplicate key value violates unique constraint/i.test(text)) {
    throw new Error(`expected a unique violation, got: ${text}`);
  }
}

/** Insert an organisation and return its id. */
export async function seedOrganisation(db: TestDb["db"], slug: string): Promise<string> {
  const [row] = await db
    .insert(schema.organisations)
    .values({ clerkOrgId: `test_${slug}`, name: slug, slug })
    .returning({ id: schema.organisations.id });
  if (!row) throw new Error("organisation insert returned no row");
  return row.id;
}
