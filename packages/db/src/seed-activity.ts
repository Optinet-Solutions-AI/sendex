import { createDb } from "./index.js";
import { isLocalDatabaseUrl, seedDemoActivity } from "./seed/demo-activity.js";
import { seedDemo } from "./seed/demo-data.js";

/**
 * Demo activity for a local database (D5-02), run with `pnpm db:seed:activity` against
 * DATABASE_URL: the demo seed first, then six weeks of made-up campaigns, messages, clicks,
 * registrations and first deposits so the KPI screens have something to show.
 *
 * It refuses any database that is not on this machine, so it can never write made-up
 * activity into the live one.
 */
if (!isLocalDatabaseUrl(process.env.DATABASE_URL)) {
  console.error(
    "db:seed:activity only runs against a local database (DATABASE_URL on localhost or 127.0.0.1).",
  );
  process.exit(1);
}
const db = createDb();
await seedDemo(db);
const summary = await seedDemoActivity(db);
console.log(
  `seeded demo activity: ${summary.lists} lists, ${summary.campaigns} campaigns, ${summary.messages} messages, ${summary.clicks} clicks, ${summary.leads} registrations, ${summary.sales} first deposits`,
);
process.exit(0);
