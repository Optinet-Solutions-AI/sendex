import { createDb } from "./index.js";
import { seedDemo } from "./seed/demo-data.js";

/**
 * Idempotent demo seed, run with `pnpm db:seed` against DATABASE_URL.
 * The data itself lives in ./seed/demo-data.ts so tests can run it on PGlite.
 */
const db = createDb();
const summary = await seedDemo(db);
console.log(
  `seeded organisations ${Object.keys(summary.organisations).join(", ")}; ${summary.contacts} contacts; ${summary.routes} routes`,
);
process.exit(0);
