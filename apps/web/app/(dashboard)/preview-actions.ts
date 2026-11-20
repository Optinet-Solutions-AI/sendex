"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { AuthError, requireOrg } from "../../lib/auth";
import { previewViewCookie, previewViewSchema } from "../../lib/preview";

export type PreviewViewResult = { ok: true } | { ok: false; error: string };

/** A year: the choice should survive until the person changes it. */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * The Existing / New switch in the top bar (D5-11). Keeps this person's choice for their
 * current organisation in a cookie; it changes nothing in the database and nothing anyone else
 * sees, so any role may use it. Refused for an organisation that is not offered the switch.
 */
export async function setPreviewViewAction(view: string): Promise<PreviewViewResult> {
  try {
    const ctx = await requireOrg();
    if (ctx.previewView === null) {
      return { ok: false, error: "This switch is not offered to your organisation." };
    }
    const choice = previewViewSchema.parse(view);
    const jar = await cookies();
    jar.set(previewViewCookie(ctx.organisationId), choice, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: "Pick Existing or New." };
    console.error("preview view failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
