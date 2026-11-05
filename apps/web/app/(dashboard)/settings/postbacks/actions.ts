"use server";

import { db, recordAudit, rotatePostbackKey } from "@sendex/db";
import { revalidatePath } from "next/cache";
import { AuthError, requireAction } from "../../../../lib/auth";
import { assertRecentAuth } from "../../../../lib/reauth";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Replace the organisation's postback secret. Owner only, with a recent sign-in (the brand's
 * tracker stops working until it is given the new secret, so this must not be casual), and
 * written to the audit log. The secret itself never goes into the audit row.
 */
export async function rotatePostbackSecretAction(): Promise<ActionResult<{ rotatedAt: string }>> {
  try {
    const ctx = await requireAction("settings.manage");
    await assertRecentAuth();
    const key = await rotatePostbackKey(db(), ctx.organisationId);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "postback.secret_rotate",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: { rotatedAt: key.rotatedAt?.toISOString() ?? null },
    });
    revalidatePath("/settings/postbacks");
    return { ok: true, data: { rotatedAt: key.rotatedAt?.toISOString() ?? "" } };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    console.error("rotate postback secret failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
