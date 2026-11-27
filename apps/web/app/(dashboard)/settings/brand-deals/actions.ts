"use server";

import { addDealSchema, dealFromForm, setOfferDealSchema } from "@sendex/core";
import {
  db,
  linkOffersToScaleoDeals,
  recomputeDealRevenue,
  recordAudit,
  saveBrandDeals,
  setOfferDeal,
} from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../../../lib/auth";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function failure(error: unknown, what: string): { ok: false; error: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
  }
  console.error(`${what} failed`, error instanceof Error ? error.message : error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/**
 * Add a deal, or a new price for one (D5-23): program, brand, the Scaleo offer it is sold
 * through, the euro CPA per first deposit and the day it starts. Offers linking to that
 * Scaleo offer get the deal, and the organisation's deposit revenue is worked out again.
 * Needs `settings.manage`.
 */
export async function addBrandDealAction(
  input: unknown,
): Promise<ActionResult<{ linked: number; earning: number }>> {
  try {
    const ctx = await requireAction("settings.manage");
    const form = addDealSchema.parse(input);
    const deal = dealFromForm(form);
    const database = db();
    await saveBrandDeals(database, ctx.organisationId, {
      deals: [deal],
      startsOn: form.startsOn,
      uploadedBy: ctx.userId,
    });
    const linked = await linkOffersToScaleoDeals(database, ctx.organisationId);
    const earning = await recomputeDealRevenue(database, ctx.organisationId);
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "deals.add",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: {
        program: form.program,
        brand: form.brand,
        scaleoOfferId: form.scaleoOfferId,
        cpaEur: form.cpaEur,
        startsOn: form.startsOn,
      },
    });
    revalidatePath("/settings/brand-deals");
    return { ok: true, data: { linked, earning } };
  } catch (error) {
    return failure(error, "add brand deal");
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
