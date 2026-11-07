"use server";

import { calendarDaySchema } from "@sendex/core";
import { type CalendarDayCampaign, db, sendCalendarDay } from "@sendex/db";
import { z } from "zod";
import type { ActionResult } from "../../../../components/campaigns/types";
import { AuthError, requireAction } from "../../../../lib/auth";

/** The Send Calendar's day modal: the campaigns that sent to one country on one day. */
export async function calendarDayAction(
  input: unknown,
): Promise<ActionResult<CalendarDayCampaign[]>> {
  try {
    const parsed = calendarDaySchema.parse(input);
    const ctx = await requireAction("campaign.view");
    return { ok: true, data: await sendCalendarDay(db(), ctx.organisationId, parsed) };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    }
    if (error instanceof Error) return { ok: false, error: error.message };
    return { ok: false, error: "Could not load the day" };
  }
}
