"use server";

import { sendingHoursFormSchema, sendingHoursFromForm } from "@sendex/core";
import { db, recordAudit, updateSendingHours } from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../../../lib/auth";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Save the organisation's suggested sending hours (D4-14). Needs `settings.manage`; the form
 * is validated with the schema and the reader from `@sendex/core`, and the change is written
 * to the audit log. Returns a result object instead of throwing.
 */
export async function updateSendingHoursAction(
  input: unknown,
): Promise<ActionResult<{ saved: true }>> {
  try {
    const ctx = await requireAction("settings.manage");
    const form = sendingHoursFormSchema.parse(input);
    const parsed = sendingHoursFromForm(form);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const database = db();
    const hours = await updateSendingHours(database, ctx.organisationId, parsed.hours);
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "settings.update",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: {
        section: "sending-hours",
        default: hours.default ? `${hours.default.from}-${hours.default.to}` : null,
        countries: Object.keys(hours.countries).length,
      },
    });
    revalidatePath("/settings/sending-hours");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    }
    console.error("sending hours action failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
