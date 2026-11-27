"use server";

import { acknowledgeAlert, db } from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../lib/auth";

export type AlertActionResult = { ok: true; acknowledged: number } | { ok: false; error: string };

const alertIdsSchema = z.array(z.uuid()).min(1).max(500);

/**
 * Acknowledge open alerts shown in the dashboard banner (D3-11): one alert, every alert of a
 * kind, or all of them (D5-24). Owner only (`settings.manage`); each `alert.acknowledge`
 * audit row is written by the query in the same transaction as its alert. Alerts of another
 * organisation, or already acknowledged, are skipped.
 */
export async function acknowledgeAlertsAction(alertIds: unknown): Promise<AlertActionResult> {
  try {
    const ctx = await requireAction("settings.manage");
    const ids = alertIdsSchema.parse(alertIds);
    const database = db();
    let acknowledged = 0;
    for (const alertId of new Set(ids)) {
      const row = await acknowledgeAlert(database, ctx.organisationId, {
        alertId,
        userId: ctx.userId,
      });
      if (row) acknowledged += 1;
    }
    revalidatePath("/", "layout");
    if (acknowledged === 0) return { ok: false, error: "These alerts were already acknowledged." };
    return { ok: true, acknowledged };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: "Invalid alert." };
    console.error("acknowledge alerts failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
