import { type Database, db, ensureOrganisation, ensureUser, upsertMembership } from "@sendex/db";
import type { OrgContext } from "./auth";
import { type DevAuthConfig, devAuthConfig } from "./env";

/**
 * Development-only sign-in stub, active when `authMode()` is `"dev"` (see `env.ts`).
 *
 * There is no Clerk session; every request is the same seeded user in the same organisation,
 * so the dashboard and Playwright can run against a local database before a Clerk
 * application exists. Rows are written through the same tenancy helpers Clerk sync uses, so
 * the rest of the app sees an ordinary organisation. Nothing here can run in production:
 * `authMode()` never returns `"dev"` when `NODE_ENV` is `production`.
 */

/** Fake Clerk ids for the seeded rows. Stable per slug so repeated runs reuse the rows. */
export function devIdentifiers(orgSlug: string): { clerkUserId: string; clerkOrgId: string } {
  return { clerkUserId: `dev_user_${orgSlug}`, clerkOrgId: `dev_org_${orgSlug}` };
}

/** "internal-ops" -> "Internal Ops" */
function nameFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Ensure the seeded user, organisation and membership exist and return their context. */
export async function devOrgContext(
  config: DevAuthConfig = devAuthConfig(),
  database: Database = db(),
): Promise<OrgContext> {
  const { clerkUserId, clerkOrgId } = devIdentifiers(config.orgSlug);
  const user = await ensureUser(database, {
    clerkUserId,
    email: `dev-${config.orgSlug}@sendex.local`,
    name: "Development user",
  });
  const organisation = await ensureOrganisation(database, {
    clerkOrgId,
    name: nameFromSlug(config.orgSlug),
    slug: config.orgSlug,
  });
  await upsertMembership(database, {
    organisationId: organisation.id,
    userId: user.id,
    role: config.role,
  });
  return {
    userId: user.id,
    clerkUserId,
    organisationId: organisation.id,
    clerkOrgId,
    role: config.role,
  };
}
