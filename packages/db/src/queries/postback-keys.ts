import { randomBytes } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { organisations } from "../schema/core.js";
import { organisationPostbackKeys } from "../schema/postback-keys.js";
import type { Db } from "../types.js";

export type PostbackKeyRow = typeof organisationPostbackKeys.$inferSelect;

/** 32 random bytes as URL-safe base64: 43 characters the brand pastes into its tracker. */
function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The organisation's postback signing secret, generated on first read. Concurrent first
 * reads race on the primary key; the loser's insert is ignored and both return the winner.
 */
export async function getOrCreatePostbackKey(
  db: Db,
  organisationId: string,
): Promise<PostbackKeyRow> {
  const [existing] = await db
    .select()
    .from(organisationPostbackKeys)
    .where(eq(organisationPostbackKeys.organisationId, organisationId))
    .limit(1);
  if (existing) return existing;
  await db
    .insert(organisationPostbackKeys)
    .values({ organisationId, secret: generateSecret() })
    .onConflictDoNothing({ target: organisationPostbackKeys.organisationId });
  const [row] = await db
    .select()
    .from(organisationPostbackKeys)
    .where(eq(organisationPostbackKeys.organisationId, organisationId))
    .limit(1);
  if (!row) throw new Error("getOrCreatePostbackKey: no row after insert");
  return row;
}

/** Replace the secret. Postbacks signed with the old one are rejected from now on. */
export async function rotatePostbackKey(db: Db, organisationId: string): Promise<PostbackKeyRow> {
  const now = new Date();
  const secret = generateSecret();
  const [row] = await db
    .insert(organisationPostbackKeys)
    .values({ organisationId, secret, rotatedAt: now })
    .onConflictDoUpdate({
      target: organisationPostbackKeys.organisationId,
      set: { secret, rotatedAt: now },
    })
    .returning();
  if (!row) throw new Error("rotatePostbackKey: no row returned");
  return row;
}

export interface OrganisationKey {
  id: string;
  slug: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the `:orgKey` of a postback URL, which is the organisation id or its slug. */
export async function findOrganisationByKey(db: Db, key: string): Promise<OrganisationKey | null> {
  const bySlug = eq(organisations.slug, key);
  const [row] = await db
    .select({ id: organisations.id, slug: organisations.slug })
    .from(organisations)
    .where(UUID.test(key) ? or(eq(organisations.id, key), bySlug) : bySlug)
    .limit(1);
  return row ?? null;
}
