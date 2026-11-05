"use server";

import { newApiTokenSchema } from "@sendex/core";
import { createApiToken, db, recordAudit, revokeApiToken } from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../../../lib/auth";
import { assertRecentAuth } from "../../../../lib/reauth";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface CreatedApiTokenView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  /** Shown once; the server keeps only its hash. */
  token: string;
}

/** A refusal with a message safe to show the user. */
class ActionFailure extends Error {}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AuthError || error instanceof ActionFailure) {
      return { ok: false, error: error.message };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid input" };
    }
    console.error("api token action failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Mint a token for the organisation. Owner only, with a recent sign-in (a token is a
 * standing credential for everything the API can do), audited without the token itself.
 */
export async function createApiTokenAction(
  input: unknown,
): Promise<ActionResult<CreatedApiTokenView>> {
  return run(async () => {
    const ctx = await requireAction("settings.manage");
    await assertRecentAuth();
    const data = newApiTokenSchema.parse(input);
    const database = db();
    const created = await createApiToken(database, ctx.organisationId, {
      name: data.name,
      scopes: data.scopes,
      createdBy: ctx.userId,
    });
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "api_token.create",
      targetType: "api_token",
      targetId: created.row.id,
      details: { name: created.row.name, prefix: created.row.prefix, scopes: created.row.scopes },
    });
    revalidatePath("/settings/api-tokens");
    return {
      id: created.row.id,
      name: created.row.name,
      prefix: created.row.prefix,
      scopes: created.row.scopes,
      token: created.token,
    };
  });
}

const revokeInput = z.object({ id: z.uuid() });

/** Revoke a token: the next API call with it answers 401. Owner only, audited. */
export async function revokeApiTokenAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("settings.manage");
    await assertRecentAuth();
    const { id } = revokeInput.parse(input);
    const database = db();
    const row = await revokeApiToken(database, ctx.organisationId, id);
    if (row === null) throw new ActionFailure("Token not found.");
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "api_token.revoke",
      targetType: "api_token",
      targetId: row.id,
      details: { name: row.name, prefix: row.prefix },
    });
    revalidatePath("/settings/api-tokens");
    return null;
  });
}
