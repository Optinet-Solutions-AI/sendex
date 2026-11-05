"use server";

import {
  type Action,
  campaignControlSchema,
  cancelScheduleSchema,
  rescheduleCampaignSchema,
} from "@sendex/core";
import {
  cancelSchedule,
  db,
  pauseCampaign,
  rescheduleCampaign,
  resumeCampaign,
  stopCampaign,
} from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult, CampaignStatus } from "../../../components/campaigns/types";
import { AuthError, type OrgContext, requireAction } from "../../../lib/auth";

/**
 * Pause, resume, stop and (re)schedule (D2-08, D2-09). Each action parses its input with the
 * `@sendex/core` schema, checks the role and calls the `@sendex/db` helper, which applies the
 * state machine, updates laps and messages and writes the audit row in one transaction.
 */

async function run<T>(
  action: Action,
  fn: (ctx: OrgContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const ctx = await requireAction(action);
    return { ok: true, data: await fn(ctx) };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    }
    if (error instanceof Error) return { ok: false, error: error.message };
    return { ok: false, error: "Something went wrong" };
  }
}

function revalidateCampaign(campaignId: string): void {
  revalidatePath("/campaigns");
  revalidatePath("/campaigns/scheduled");
  revalidatePath(`/campaigns/${campaignId}`);
}

/** Pausing and stopping need `campaign.stop`; resuming is sending again, so `campaign.send`. */
const PERMISSION: Record<"pause" | "resume" | "stop", Action> = {
  pause: "campaign.stop",
  resume: "campaign.send",
  stop: "campaign.stop",
};

export interface ControlOutcome {
  status: CampaignStatus;
  cancelledLaps?: number;
  cancelledMessages?: number;
}

export async function controlCampaignAction(input: unknown): Promise<ActionResult<ControlOutcome>> {
  const parsed = campaignControlSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { campaignId, action } = parsed.data;
  return run(PERMISSION[action], async (ctx) => {
    const database = db();
    const input = { actorUserId: ctx.userId };
    const result =
      action === "pause"
        ? await pauseCampaign(database, ctx.organisationId, campaignId, input)
        : action === "resume"
          ? await resumeCampaign(database, ctx.organisationId, campaignId, input)
          : await stopCampaign(database, ctx.organisationId, campaignId, input);
    revalidateCampaign(campaignId);
    return result;
  });
}

export async function rescheduleCampaignAction(
  input: unknown,
): Promise<ActionResult<{ status: CampaignStatus; scheduledAt: string }>> {
  return run("campaign.send", async (ctx) => {
    const data = rescheduleCampaignSchema.parse(input);
    const result = await rescheduleCampaign(db(), ctx.organisationId, data.campaignId, {
      scheduledAt: new Date(data.scheduledAt),
      actorUserId: ctx.userId,
    });
    revalidateCampaign(data.campaignId);
    return { status: result.status, scheduledAt: result.scheduledAt.toISOString() };
  });
}

export async function cancelScheduleAction(
  input: unknown,
): Promise<ActionResult<{ status: CampaignStatus; cancelledLaps: number }>> {
  return run("campaign.send", async (ctx) => {
    const data = cancelScheduleSchema.parse(input);
    const result = await cancelSchedule(db(), ctx.organisationId, data.campaignId, {
      actorUserId: ctx.userId,
    });
    revalidateCampaign(data.campaignId);
    return result;
  });
}
