import { createDb } from "./index.js";
import { organisations } from "./schema/index.js";

/**
 * Idempotent seed: two organisations (External, Internal). Lists, campaigns and
 * demo numbers are added by later cards (D1-13) once their tables exist.
 */
const db = createDb();

const orgs = [
  { clerkOrgId: "seed_org_external", name: "External", slug: "external" },
  { clerkOrgId: "seed_org_internal", name: "Internal", slug: "internal" },
];

for (const o of orgs) {
  await db
    .insert(organisations)
    .values(o)
    .onConflictDoNothing({ target: organisations.clerkOrgId });
}

console.log("seeded organisations:", orgs.map((o) => o.name).join(", "));
process.exit(0);
