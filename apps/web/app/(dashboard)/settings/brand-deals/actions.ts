"use server";

import { parseDealSheet, setOfferDealSchema, uploadDealsSchema } from "@sendex/core";
import { db, recomputeDealRevenue, recordAudit, saveBrandDeals, setOfferDeal } from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../../../lib/auth";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface UploadSummary {
  saved: number;
  priced: number;
  /** Rows left out, with why (e.g. a date that is not a date). */
  problems: string[];
  /** First deposits that earn something after the upload. */
  earning: number;
}

function failure(error: unknown, what: string): { ok: false; error: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
  }
  console.error(`${what} failed`, error instanceof Error ? error.message : error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/**
 * Store the brand deals of a Media Deals export (D5-16), then work out the organisation's
 * deposit revenue again. The browser sends only the deal columns. Needs `settings.manage`.
 */
export async function uploadBrandDealsAction(input: unknown): Promise<ActionResult<UploadSummary>> {
  try {
    const ctx = await requireAction("settings.manage");
    const { startsOn, fileName, rows } = uploadDealsSchema.parse(input);
    const sheet = parseDealSheet(rows);
    if (!sheet.ok) return { ok: false, error: sheet.error };
    if (sheet.deals.length === 0) return { ok: false, error: "No brands found in the file." };
    const database = db();
    const saved = await saveBrandDeals(database, ctx.organisationId, {
      deals: sheet.deals,
      startsOn,
      uploadedBy: ctx.userId,
    });
    const earning = await recomputeDealRevenue(database, ctx.organisationId);
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "deals.upload",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: { fileName, startsOn, saved: saved.saved, priced: saved.priced },
    });
    revalidatePath("/settings/brand-deals");
    return { ok: true, data: { ...saved, problems: sheet.problems, earning } };
  } catch (error) {
    return failure(error, "brand deals upload");
  }
}

/**
 * Choose the brand deal an offer earns from (or none), then work out the organisation's
 * deposit revenue again. Needs `settings.manage`.
 */
export async function setOfferDealAction(
  input: unknown,
): Promise<ActionResult<{ earning: number }>> {
  try {
    const ctx = await requireAction("settings.manage");
    const { linkId, dealKey } = setOfferDealSchema.parse(input);
    const database = db();
    if (!(await setOfferDeal(database, ctx.organisationId, linkId, dealKey))) {
      return { ok: false, error: "Offer not found." };
    }
    const earning = await recomputeDealRevenue(database, ctx.organisationId);
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "offer.deal",
      targetType: "link",
      targetId: linkId,
      details: { dealKey },
    });
    revalidatePath("/settings/brand-deals");
    return { ok: true, data: { earning } };
  } catch (error) {
    return failure(error, "offer deal");
  }
}
