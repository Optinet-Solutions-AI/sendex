"use server";

import type { EmergencyStopState } from "@sendex/core";
import { db, recordAudit } from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../../../lib/auth";
import {
  clearEmergencyStopFlag,
  raiseEmergencyStop,
  WorkerApiError,
} from "../../../../lib/worker-api";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const raiseInput = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Give a reason")
    .max(200, "Keep the reason under 200 characters"),
});

function failure(error: unknown): ActionResult<never> {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
  }
  if (error instanceof WorkerApiError) return { ok: false, error: `Worker: ${error.message}` };
  if (error instanceof Error && error.name === "TimeoutError") {
    return { ok: false, error: "The worker did not answer in time" };
  }
  console.error("emergency stop action failed", error instanceof Error ? error.message : error);
  return { ok: false, error: "The worker could not be reached" };
}

function revalidate(): void {
  revalidatePath("/settings/emergency-stop");
  revalidatePath("/", "layout");
}

/**
 * Raise the organisation's emergency stop (owner only): the worker sets the Redis flag that
 * every send loop checks per batch, and the audit log records who and why.
 */
export async function raiseEmergencyStopAction(
  input: unknown,
): Promise<ActionResult<EmergencyStopState>> {
  try {
    const ctx = await requireAction("emergency.stop");
    const { reason } = raiseInput.parse(input);
    const state = await raiseEmergencyStop(ctx.organisationId, { reason, byUserId: ctx.userId });
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "emergency.stop",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: { reason },
    });
    revalidate();
    return { ok: true, data: state };
  } catch (error) {
    return failure(error);
  }
}

/** Clear the flag so new laps are dispatched again; sending resumes only for campaigns that are still `sending`. */
export async function clearEmergencyStopAction(): Promise<ActionResult<EmergencyStopState>> {
  try {
    const ctx = await requireAction("emergency.stop");
    const state = await clearEmergencyStopFlag(ctx.organisationId);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "emergency.clear",
      targetType: "organisation",
      targetId: ctx.organisationId,
    });
    revalidate();
    return { ok: true, data: state };
  } catch (error) {
    return failure(error);
  }
}
