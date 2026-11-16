"use server";

import {
  CREATOR_PERIODS,
  type CreatorPeriod,
  creatorPeriod,
  plannedCampaignSchema,
} from "@sendex/core";
import {
  createPlannedCampaign,
  db,
  getList,
  kpiByOfferCountry,
  kpiFilterOptions,
  listFollowUp,
  listOfferPairs,
  recordAudit,
  routesForCountry,
} from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CreatorData } from "../../../components/kpi/campaign-creator";
import { AuthError, requireAction } from "../../../lib/auth";
import { assertCountryOpen, ClosedCountryError } from "../../../lib/open-countries";

/**
 * Server actions of the Performance screens (D5-07 onwards). Each resolves the tenant with
 * `requireAction`, validates with the Zod schemas of `@sendex/core` and returns a result
 * object so the client can show the message.
 */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Messages of the database helpers that are safe and useful to show as they are. */
const SHOWN = [/^List not found$/, /^Offer not found$/, /^This route cannot carry a campaign for /];

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof ClosedCountryError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    }
    if (error instanceof Error && SHOWN.some((pattern) => pattern.test(error.message))) {
      return { ok: false, error: error.message };
    }
    console.error("kpi action failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Everything the campaign creator ranks on for one data period: the offers, the lists, what
 * each offer did per country and per list inside the period and ever, and the routes that can
 * carry each list country with their price.
 */
export async function campaignCreatorDataAction(
  period: CreatorPeriod,
): Promise<ActionResult<CreatorData>> {
  return run(async () => {
    const ctx = await requireAction("campaign.view");
    const chosen = z.enum(CREATOR_PERIODS).parse(period);
    const window = creatorPeriod(chosen, new Date());
    const filter = { from: window.from, to: window.to };
    const database = db();
    const org = ctx.organisationId;
    const [options, lists, inPeriod, ever, pairsPeriod, pairsEver] = await Promise.all([
      kpiFilterOptions(database, org),
      listFollowUp(database, org, {}),
      kpiByOfferCountry(database, org, filter),
      kpiByOfferCountry(database, org, {}),
      listOfferPairs(database, org, filter),
      listOfferPairs(database, org, {}),
    ]);
    const routeLists = await Promise.all(
      options.countries.map(async (country) => {
        const routes = await routesForCountry(database, org, country);
        return [
          country,
          routes.map((r) => ({
            id: r.id,
            name: r.name,
            platform: r.platform,
            priceMicro: r.priceMicro === null ? null : r.priceMicro.toString(),
          })),
        ] as const;
      }),
    );
    const counters = (rows: typeof inPeriod) =>
      rows.map((r) => ({
        ...r,
        costMicro: r.costMicro.toString(),
        revenueMicro: r.revenueMicro.toString(),
      }));
    const pairs = (rows: typeof pairsEver) =>
      rows.map((p) => ({ ...p, lastSentAt: p.lastSentAt?.toISOString() ?? null }));
    return {
      period: chosen,
      periodLabel: window.label,
      offers: options.offers,
      lists: lists.map((l) => ({
        listId: l.listId,
        name: l.name,
        country: l.country,
        provider: l.provider,
        numbersCount: l.numbersCount,
        lastSentAt: l.lastSentAt?.toISOString() ?? null,
        sales: l.sales,
      })),
      inPeriod: counters(inPeriod),
      ever: counters(ever),
      pairsPeriod: pairs(pairsPeriod),
      pairsEver: pairs(pairsEver),
      routes: Object.fromEntries(routeLists),
    };
  });
}

/** The creator's last step: a draft campaign with its list, offer, route and planned day. */
export async function createPlannedCampaignAction(
  input: unknown,
): Promise<ActionResult<{ campaignId: string; name: string }>> {
  return run(async () => {
    const ctx = await requireAction("campaign.create");
    const data = plannedCampaignSchema.parse(input);
    const database = db();
    const list = await getList(database, ctx.organisationId, data.listId);
    if (!list) throw new Error("List not found");
    assertCountryOpen(list.country);
    const campaign = await createPlannedCampaign(database, ctx.organisationId, {
      ...data,
      createdBy: ctx.userId,
    });
    await recordAudit(database, ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "campaign.create",
      targetType: "campaign",
      targetId: campaign.id,
      details: {
        name: campaign.name,
        country: campaign.country,
        plannedFor: data.plannedFor,
        fromCreator: true,
      },
    });
    revalidatePath("/campaigns");
    revalidatePath("/kpi/list-follow-up");
    return { campaignId: campaign.id, name: campaign.name };
  });
}
