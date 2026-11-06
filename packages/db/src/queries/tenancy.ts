import type { Role } from "@sendex/core";
import { and, eq } from "drizzle-orm";
import type { Database } from "../index.js";
import { memberships, organisations, users } from "../schema/index.js";
import type { Db } from "../types.js";

export type UserRow = typeof users.$inferSelect;
export type OrganisationRow = typeof organisations.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;

export interface EnsureUserInput {
  clerkUserId: string;
  email: string;
  name?: string | null;
}

export interface EnsureOrganisationInput {
  clerkOrgId: string;
  name: string;
  slug: string;
}

export interface MembershipKey {
  organisationId: string;
  userId: string;
}

export interface UpsertMembershipInput extends MembershipKey {
  role: Role;
}

export interface TenantLookup {
  user: UserRow;
  organisation: OrganisationRow;
  /** Null when the user has no membership row in the organisation yet. */
  membershipRole: Role | null;
}

/**
 * The user, the organisation and the user's role in it, in one round trip: what every
 * dashboard request needs before it can render. Null when either row does not exist locally
 * yet (first sight of a user or organisation); the caller then creates them one by one.
 */
export async function getTenantByClerkIds(
  db: Db,
  ids: { clerkUserId: string; clerkOrgId: string },
): Promise<TenantLookup | null> {
  const [row] = await db
    .select({ user: users, organisation: organisations, membershipRole: memberships.role })
    .from(users)
    .innerJoin(organisations, eq(organisations.clerkOrgId, ids.clerkOrgId))
    .leftJoin(
      memberships,
      and(eq(memberships.organisationId, organisations.id), eq(memberships.userId, users.id)),
    )
    .where(eq(users.clerkUserId, ids.clerkUserId))
    .limit(1);
  if (!row) return null;
  return { user: row.user, organisation: row.organisation, membershipRole: row.membershipRole };
}

/** Find the local user mirrored from a Clerk user, if the webhook or a sign-in has created it. */
export async function getUserByClerkId(db: Database, clerkUserId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
  return row ?? null;
}

/** Find the local organisation mirrored from a Clerk organisation. */
export async function getOrganisationByClerkId(
  db: Database,
  clerkOrgId: string,
): Promise<OrganisationRow | null> {
  const [row] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.clerkOrgId, clerkOrgId))
    .limit(1);
  return row ?? null;
}

/** Find an organisation by its unique slug (used by the seed and the development auth stub). */
export async function getOrganisationBySlug(
  db: Database,
  slug: string,
): Promise<OrganisationRow | null> {
  const [row] = await db.select().from(organisations).where(eq(organisations.slug, slug)).limit(1);
  return row ?? null;
}

/** Create or refresh the local user for a Clerk user id. Idempotent. */
export async function ensureUser(db: Database, input: EnsureUserInput): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({ clerkUserId: input.clerkUserId, email: input.email, name: input.name ?? null })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { email: input.email, name: input.name ?? null },
    })
    .returning();
  if (!row) throw new Error(`ensureUser: no row returned for ${input.clerkUserId}`);
  return row;
}

/** Create or refresh the local organisation for a Clerk organisation id. Idempotent. */
export async function ensureOrganisation(
  db: Database,
  input: EnsureOrganisationInput,
): Promise<OrganisationRow> {
  const [row] = await db
    .insert(organisations)
    .values({ clerkOrgId: input.clerkOrgId, name: input.name, slug: input.slug })
    .onConflictDoUpdate({
      target: organisations.clerkOrgId,
      set: { name: input.name, slug: input.slug, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error(`ensureOrganisation: no row returned for ${input.clerkOrgId}`);
  return row;
}

/** The membership of a user in an organisation, or null when they are not a member. */
export async function getMembership(
  db: Database,
  key: MembershipKey,
): Promise<MembershipRow | null> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.organisationId, key.organisationId), eq(memberships.userId, key.userId)),
    )
    .limit(1);
  return row ?? null;
}

/** Create the membership or update its role. Idempotent on (organisation, user). */
export async function upsertMembership(
  db: Database,
  input: UpsertMembershipInput,
): Promise<MembershipRow> {
  const [row] = await db
    .insert(memberships)
    .values({ organisationId: input.organisationId, userId: input.userId, role: input.role })
    .onConflictDoUpdate({
      target: [memberships.organisationId, memberships.userId],
      set: { role: input.role },
    })
    .returning();
  if (!row) throw new Error("upsertMembership: no row returned");
  return row;
}

/** Remove a membership. Returns true when a row was deleted. */
export async function removeMembership(db: Database, key: MembershipKey): Promise<boolean> {
  const deleted = await db
    .delete(memberships)
    .where(
      and(eq(memberships.organisationId, key.organisationId), eq(memberships.userId, key.userId)),
    )
    .returning({ id: memberships.id });
  return deleted.length > 0;
}

/** Find an organisation by its local id (the public API's `/me`). */
export async function getOrganisationById(db: Db, id: string): Promise<OrganisationRow | null> {
  const [row] = await db.select().from(organisations).where(eq(organisations.id, id)).limit(1);
  return row ?? null;
}
