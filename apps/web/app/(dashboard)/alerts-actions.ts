"use server";

import { acknowledgeAlert, db } from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../lib/auth";

export type AlertActionResult = { ok: true } | { ok: false; error: string };

const alertIdSchema = z.uuid();

/**
 * Acknowledge an open alert shown in the dashboard banner (D3-11). Owner only
 * (`settings.manage`); the audit row `alert.acknowledge` is written by the query in the same
 * transaction. An alert of another organisation, or one already acknowledged, is reported as
 * gone rather than failing.
 */
export async function acknowledgeAlertAction(alertId: string): Promise<AlertActionResult> {
  try {
    const ctx = await requireAction("settings.manage");
    const id = alertIdSchema.parse(alertId);
    const row = await acknowledgeAlert(db(), ctx.organisationId, {
      alertId: id,
      userId: ctx.userId,
    });
    revalidatePath("/", "layout");
    if (!row) return { ok: false, error: "This alert was already acknowledged." };
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: "Invalid alert." };
    console.error("acknowledge alert failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
