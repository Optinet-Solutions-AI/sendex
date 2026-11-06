import { type ApiTokenScope, displayPrefix, generateApiToken, hashApiToken } from "@sendex/core";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { apiTokens } from "../schema/api-tokens.js";
import type { Db } from "../types.js";

export type ApiTokenRow = typeof apiTokens.$inferSelect;

/** What the settings page lists: everything but the hash. */
export type ApiTokenListRow = Omit<ApiTokenRow, "tokenHash">;

export interface CreateApiTokenInput {
  name: string;
  scopes: readonly ApiTokenScope[];
  createdBy?: string | null;
}

export interface CreatedApiToken {
  /** The plaintext, returned once and never stored. */
  token: string;
  row: ApiTokenRow;
}

/** Mint a token for the organisation; the caller shows `token` once and keeps nothing. */
export async function createApiToken(
  db: Db,
  organisationId: string,
  input: CreateApiTokenInput,
): Promise<CreatedApiToken> {
  const token = generateApiToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      organisationId,
      name: input.name,
      prefix: displayPrefix(token),
      tokenHash: await hashApiToken(token),
      scopes: [...input.scopes],
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!row) throw new Error("createApiToken: no row returned");
  return { token, row };
}

const listColumns = {
  id: apiTokens.id,
  organisationId: apiTokens.organisationId,
  name: apiTokens.name,
  prefix: apiTokens.prefix,
  scopes: apiTokens.scopes,
  createdBy: apiTokens.createdBy,
  createdAt: apiTokens.createdAt,
  lastUsedAt: apiTokens.lastUsedAt,
  revokedAt: apiTokens.revokedAt,
};

/** The organisation's tokens, newest first, revoked ones included. */
export async function listApiTokens(db: Db, organisationId: string): Promise<ApiTokenListRow[]> {
  return db
    .select(listColumns)
    .from(apiTokens)
    .where(eq(apiTokens.organisationId, organisationId))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
}

/**
 * Revoke a token of the organisation. Idempotent: an already revoked token keeps its
 * original `revoked_at`. Null when the token is not the organisation's.
 */
export async function revokeApiToken(
  db: Db,
  organisationId: string,
  id: string,
): Promise<ApiTokenListRow | null> {
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.organisationId, organisationId),
        eq(apiTokens.id, id),
        isNull(apiTokens.revokedAt),
      ),
    );
  const [row] = await db
    .select(listColumns)
    .from(apiTokens)
    .where(and(eq(apiTokens.organisationId, organisationId), eq(apiTokens.id, id)))
    .limit(1);
  return row ?? null;
}

/** `last_used_at` is written at most this often per token, to keep reads cheap. */
const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * The authentication lookup of the public API: the live (not revoked) token with this hash,
 * or null. Not tenant-scoped by nature; the row's `organisationId` is what scopes everything
 * the request then does. Stamps `last_used_at` (at most once a minute).
 */
export async function findApiTokenByHash(db: Db, tokenHash: string): Promise<ApiTokenRow | null> {
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)))
    .limit(1);
  if (!row) return null;
  const now = new Date();
  await db
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiTokens.id, row.id),
        or(
          isNull(apiTokens.lastUsedAt),
          lt(apiTokens.lastUsedAt, new Date(now.getTime() - LAST_USED_RESOLUTION_MS)),
        ),
      ),
    );
  return row;
}
