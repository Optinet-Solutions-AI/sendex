import { type SheetDeal, scaleoDealKey, scaleoOfferIdFromUrl } from "@sendex/core";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { links } from "../schema/campaigns.js";
import { brandDeals } from "../schema/deals.js";
import type { Db } from "../types.js";
import { rowsOf } from "./dashboard.js";

/**
 * Brand deals (D5-16). Revenue is earned per first deposit: the CPA of the deal chosen on the
 * message's offer, in force on the day of the deposit. It is written on the deposit postback
 * (`postbacks.revenue_micro`) and summed on the lap (`laps.revenue_micro`).
 */

export interface SaveBrandDealsInput {
  deals: readonly SheetDeal[];
  /** YYYY-MM-DD for rows without a date of their own. */
  startsOn: string;
  uploadedBy: string | null;
}

/**
 * Store an upload. A deal for the same program, brand and start day is replaced; other days
 * stay, so the price history is kept.
 */
export async function saveBrandDeals(
  db: Db,
  organisationId: string,
  input: SaveBrandDealsInput,
): Promise<{ saved: number; priced: number }> {
  const rows = new Map<string, typeof brandDeals.$inferInsert>();
  for (const d of input.deals) {
    const startsOn = d.startsOn ?? input.startsOn;
    rows.set(`${d.key} ${startsOn}`, {
      organisationId,
      dealKey: d.key,
      program: d.program,
      brand: d.brand,
      deal: d.deal,
      topGeos: d.topGeos,
      cpaMicro: d.cpaMicro,
      reason: d.reason,
      startsOn,
      uploadedBy: input.uploadedBy,
    });
  }
  const values = [...rows.values()];
  if (values.length > 0) {
    await db
      .insert(brandDeals)
      .values(values)
      .onConflictDoUpdate({
        target: [brandDeals.organisationId, brandDeals.dealKey, brandDeals.startsOn],
        set: {
          program: sql`excluded.program`,
          brand: sql`excluded.brand`,
          deal: sql`excluded.deal`,
          topGeos: sql`excluded.top_geos`,
          cpaMicro: sql`excluded.cpa_micro`,
          reason: sql`excluded.reason`,
          uploadedBy: sql`excluded.uploaded_by`,
          createdAt: sql`now()`,
        },
      });
  }
  return { saved: values.length, priced: values.filter((v) => v.cpaMicro != null).length };
}

export interface BrandDealRow {
  key: string;
  program: string;
  brand: string;
  deal: string;
  topGeos: string;
  cpaMicro: bigint | null;
  reason: string | null;
  startsOn: string;
}

/**
 * One deal per program and brand: the one in force on `today` (YYYY-MM-DD), or, for a deal
 * that only starts later, its first one. Ordered by brand.
 */
export async function currentBrandDeals(
  db: Db,
  organisationId: string,
  today: string,
): Promise<BrandDealRow[]> {
  const inForce = sql`${brandDeals.startsOn} <= ${today}::date`;
  const rows = await db
    .selectDistinctOn([brandDeals.dealKey], {
      key: brandDeals.dealKey,
      program: brandDeals.program,
      brand: brandDeals.brand,
      deal: brandDeals.deal,
      topGeos: brandDeals.topGeos,
      cpaMicro: brandDeals.cpaMicro,
      reason: brandDeals.reason,
      startsOn: brandDeals.startsOn,
    })
    .from(brandDeals)
    .where(eq(brandDeals.organisationId, organisationId))
    .orderBy(
      brandDeals.dealKey,
      desc(inForce),
      sql`case when ${inForce} then ${brandDeals.startsOn} end desc nulls last`,
      asc(brandDeals.startsOn),
    );
  return rows.sort((a, b) => a.brand.localeCompare(b.brand) || a.program.localeCompare(b.program));
}

/** The CPA (micro-EUR) of the deal in force on the UTC day of `at`, or null. */
export async function dealCpaAt(
  db: Db,
  organisationId: string,
  key: string,
  at: Date,
): Promise<bigint | null> {
  const [row] = await db
    .select({ cpaMicro: brandDeals.cpaMicro })
    .from(brandDeals)
    .where(
      and(
        eq(brandDeals.organisationId, organisationId),
        eq(brandDeals.dealKey, key),
        lte(brandDeals.startsOn, at.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(desc(brandDeals.startsOn))
    .limit(1);
  return row?.cpaMicro ?? null;
}

export interface OfferDealRow {
  id: string;
  name: string;
  url: string;
  dealKey: string | null;
}

/** The organisation's offers with the deal each earns from, by name. */
export async function listOffersWithDeals(db: Db, organisationId: string): Promise<OfferDealRow[]> {
  return db
    .select({ id: links.id, name: links.name, url: links.url, dealKey: links.dealKey })
    .from(links)
    .where(eq(links.organisationId, organisationId))
    .orderBy(asc(links.name), asc(links.id));
}

/** Choose the deal an offer earns from (null for none). False for another organisation's offer. */
export async function setOfferDeal(
  db: Db,
  organisationId: string,
  linkId: string,
  key: string | null,
): Promise<boolean> {
  const updated = await db
    .update(links)
    .set({ dealKey: key })
    .where(and(eq(links.id, linkId), eq(links.organisationId, organisationId)))
    .returning({ id: links.id });
  return updated.length > 0;
}

/**
 * Work out the organisation's deposit revenue again from its deals, after an upload or a
 * change of an offer's deal: each message's first deposit earns the CPA in force that day,
 * later deposits nothing, and every lap's revenue is the sum of its postbacks. One
 * transaction; returns the number of deposits that earn something.
 */
export async function recomputeDealRevenue(db: Db, organisationId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      update postbacks set revenue_micro = null
      where organisation_id = ${organisationId} and revenue_micro is not null`);
    const earned = await tx.execute(sql`
      update postbacks p set revenue_micro = d.cpa
      from (
        select distinct on (s.message_id) s.id,
          (select bd.cpa_micro from brand_deals bd
            where bd.organisation_id = ${organisationId} and bd.deal_key = lk.deal_key
              and bd.starts_on <= (s.received_at at time zone 'UTC')::date
            order by bd.starts_on desc limit 1) as cpa
        from postbacks s
        join messages m on m.id = s.message_id
        join links lk on lk.id = m.link_id
        where s.organisation_id = ${organisationId} and s.type = 'sale'
        order by s.message_id, s.received_at, s.id
      ) d
      where p.id = d.id and d.cpa is not null
      returning p.id`);
    await tx.execute(sql`
      update laps l set revenue_micro = coalesce(
        (select sum(p.revenue_micro) from postbacks p where p.lap_id = l.id), 0)
      where l.organisation_id = ${organisationId}`);
    return rowsOf(earned).length;
  });
}

/**
 * Give each offer without a deal the deal of the Scaleo offer its link points to (D5-23):
 * `…/click?o=1234…` earns the deal kept as `scaleo:1234`. A deal chosen by hand is left alone.
 * Returns how many offers were linked.
 */
export async function linkOffersToScaleoDeals(db: Db, organisationId: string): Promise<number> {
  const [offers, deals] = await Promise.all([
    db
      .select({ id: links.id, url: links.url })
      .from(links)
      .where(and(eq(links.organisationId, organisationId), isNull(links.dealKey))),
    db
      .selectDistinct({ key: brandDeals.dealKey })
      .from(brandDeals)
      .where(eq(brandDeals.organisationId, organisationId)),
  ]);
  const known = new Set(deals.map((d) => d.key));
  const byKey = new Map<string, string[]>();
  for (const offer of offers) {
    const id = scaleoOfferIdFromUrl(offer.url);
    if (id === null) continue;
    const key = scaleoDealKey(id);
    if (!known.has(key)) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), offer.id]);
  }
  let linked = 0;
  for (const [key, ids] of byKey) {
    const updated = await db
      .update(links)
      .set({ dealKey: key })
      .where(
        and(
          eq(links.organisationId, organisationId),
          inArray(links.id, ids),
          isNull(links.dealKey),
        ),
      )
      .returning({ id: links.id });
    linked += updated.length;
  }
  return linked;
}
