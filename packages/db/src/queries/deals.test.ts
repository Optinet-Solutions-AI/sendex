import { dealKey, type SheetDeal } from "@sendex/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  brandDeals,
  campaigns,
  contacts,
  laps,
  links,
  lists,
  messages,
  postbacks,
  routes,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  currentBrandDeals,
  dealCpaAt,
  linkOffersToScaleoDeals,
  listOffersWithDeals,
  recomputeDealRevenue,
  saveBrandDeals,
  setOfferDeal,
} from "./deals.js";
import { attributePostback, insertPostback } from "./postbacks.js";

let t: TestDb;
let org: string;
let otherOrg: string;
let lapId: string;
let brandALink: string;
let plainLink: string;
let otherOrgLink: string;

const BRAND_A = dealKey("Example Partners", "Brand A");
const BRAND_B = dealKey("Example Partners", "Brand B");

function deal(brand: string, cpaEur: number | null, startsOn: string | null = null): SheetDeal {
  return {
    key: dealKey("Example Partners", brand),
    program: "Example Partners",
    brand,
    deal: cpaEur === null ? "No Deal Yet" : `€${cpaEur} CPA + 40% rev`,
    topGeos: "UK",
    startsOn,
    cpaMicro: cpaEur === null ? null : BigInt(cpaEur) * 1_000_000n,
    reason: cpaEur === null ? "No CPA in the deal" : null,
  };
}

async function addMessage(dyn: string, linkId: string | null): Promise<void> {
  const [lap] = await t.db.select().from(laps).where(eq(laps.id, lapId));
  const [contact] = await t.db.select().from(contacts).where(eq(contacts.organisationId, org));
  if (!lap || !contact) throw new Error("setup failed");
  await t.db.insert(messages).values({
    organisationId: org,
    campaignId: lap.campaignId,
    lapId,
    contactId: contact.id,
    routeId: lap.routeId,
    linkId,
    e164: "+447700900001",
    senderId: "SID",
    text: "hi",
    encoding: "GSM_7BIT",
    dynamicId: dyn,
    status: "delivered",
    idempotencyKey: `k-${dyn}`,
  });
}

async function deposit(dyn: string, key: string, at: string): Promise<string> {
  const { postback } = await insertPostback(t.db, org, {
    eventKey: key,
    type: "sale",
    dynamicId: dyn,
    // What the tracker says: not revenue.
    valueMicro: 50_000_000n,
    params: {},
    receivedAt: new Date(at),
  });
  await attributePostback(t.db, postback);
  return postback.id;
}

async function revenueOf(postbackId: string): Promise<bigint | null> {
  const [row] = await t.db
    .select({ revenue: postbacks.revenueMicro })
    .from(postbacks)
    .where(eq(postbacks.id, postbackId));
  return row?.revenue ?? null;
}

async function lapRevenue(): Promise<bigint | undefined> {
  const [lap] = await t.db.select().from(laps).where(eq(laps.id, lapId));
  return lap?.revenueMicro;
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "deals-a");
  otherOrg = await seedOrganisation(t.db, "deals-b");
  const [campaign] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "UK", country: "GB", timezone: "Europe/London" })
    .returning({ id: campaigns.id });
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "l", country: "GB" })
    .returning({ id: lists.id });
  const [route] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "r", country: "GB" })
    .returning({ id: routes.id });
  await t.db.insert(contacts).values({ organisationId: org, e164: "+447700900001", country: "GB" });
  const linkRows = await t.db
    .insert(links)
    .values([
      { organisationId: org, name: "Brand A UK", url: "https://a.example/?d={{dynamic}}" },
      { organisationId: org, name: "Other offer", url: "https://b.example/?d={{dynamic}}" },
      { organisationId: otherOrg, name: "Brand A", url: "https://c.example/" },
    ])
    .returning({ id: links.id });
  if (!campaign || !list || !route || linkRows.length !== 3) throw new Error("setup failed");
  const [lap] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId: campaign.id,
      listId: list.id,
      routeId: route.id,
      testSize: 10,
      sent: 10,
    })
    .returning({ id: laps.id });
  if (!lap) throw new Error("setup failed");
  lapId = lap.id;
  [brandALink, plainLink, otherOrgLink] = linkRows.map((l) => l.id) as [string, string, string];
});

afterAll(async () => {
  await t.close();
});

describe("brand deals (D5-16)", () => {
  it("stores an upload with the upload day for rows without a date of their own", async () => {
    const saved = await saveBrandDeals(t.db, org, {
      deals: [deal("Brand A", 200), deal("Brand B", null), deal("Brand A", 150, "2026-10-01")],
      startsOn: "2026-11-01",
      uploadedBy: "user_1",
    });
    expect(saved).toEqual({ saved: 3, priced: 2 });
    const current = await currentBrandDeals(t.db, org, "2026-11-25");
    expect(current.map((d) => [d.brand, d.cpaMicro, d.startsOn, d.reason])).toEqual([
      ["Brand A", 200_000_000n, "2026-11-01", null],
      ["Brand B", null, "2026-11-01", "No CPA in the deal"],
    ]);
    expect(await currentBrandDeals(t.db, otherOrg, "2026-11-25")).toEqual([]);
  });

  it("replaces a deal uploaded again for the same day", async () => {
    await saveBrandDeals(t.db, org, {
      deals: [deal("Brand A", 210)],
      startsOn: "2026-11-01",
      uploadedBy: null,
    });
    const rows = await t.db.select().from(brandDeals).where(eq(brandDeals.dealKey, BRAND_A));
    expect(rows.map((r) => [r.startsOn, r.cpaMicro]).sort()).toEqual([
      ["2026-10-01", 150_000_000n],
      ["2026-11-01", 210_000_000n],
    ]);
  });

  it("gives the CPA in force on a day, and none before the first deal", async () => {
    expect(await dealCpaAt(t.db, org, BRAND_A, new Date("2026-11-20T10:00:00Z"))).toBe(
      210_000_000n,
    );
    expect(await dealCpaAt(t.db, org, BRAND_A, new Date("2026-10-15T10:00:00Z"))).toBe(
      150_000_000n,
    );
    expect(await dealCpaAt(t.db, org, BRAND_A, new Date("2026-09-30T23:00:00Z"))).toBeNull();
    expect(await dealCpaAt(t.db, org, BRAND_B, new Date("2026-11-20T10:00:00Z"))).toBeNull();
    expect(await dealCpaAt(t.db, otherOrg, BRAND_A, new Date("2026-11-20T10:00:00Z"))).toBeNull();
  });

  it("sets an offer's deal within the organisation only", async () => {
    expect(await setOfferDeal(t.db, org, brandALink, BRAND_A)).toBe(true);
    expect(await setOfferDeal(t.db, org, otherOrgLink, BRAND_A)).toBe(false);
    const offers = await listOffersWithDeals(t.db, org);
    expect(offers.map((o) => [o.name, o.dealKey])).toEqual([
      ["Brand A UK", BRAND_A],
      ["Other offer", null],
    ]);
  });

  it("earns the brand's CPA on a first deposit, not the tracker's amount, and nothing on a repeat", async () => {
    await addMessage("dyn-1", brandALink);
    const first = await deposit("dyn-1", "sale-1", "2026-11-20T09:00:00Z");
    const repeat = await deposit("dyn-1", "sale-1b", "2026-11-21T09:00:00Z");
    expect(await revenueOf(first)).toBe(210_000_000n);
    expect(await revenueOf(repeat)).toBeNull();
    expect(await lapRevenue()).toBe(210_000_000n);
  });

  it("earns nothing for an offer without a deal", async () => {
    await addMessage("dyn-2", plainLink);
    const sale = await deposit("dyn-2", "sale-2", "2026-11-20T09:00:00Z");
    expect(await revenueOf(sale)).toBeNull();
    expect(await lapRevenue()).toBe(210_000_000n);
  });

  it("works out past deposits again after a new upload or an offer's deal changes", async () => {
    // Before Brand B had a price, a deposit on a Brand B offer earned nothing.
    await setOfferDeal(t.db, org, plainLink, BRAND_B);
    await saveBrandDeals(t.db, org, {
      deals: [deal("Brand B", 120)],
      startsOn: "2026-11-15",
      uploadedBy: null,
    });
    await recomputeDealRevenue(t.db, org);
    const [sale2] = await t.db
      .select({ revenue: postbacks.revenueMicro })
      .from(postbacks)
      .where(eq(postbacks.eventKey, "sale-2"));
    expect(sale2?.revenue).toBe(120_000_000n);
    expect(await lapRevenue()).toBe(330_000_000n);

    await setOfferDeal(t.db, org, plainLink, null);
    await recomputeDealRevenue(t.db, org);
    expect(await lapRevenue()).toBe(210_000_000n);
  });
});

describe("offers find their deal by Scaleo offer (D5-23)", () => {
  it("links offers whose link points to a Scaleo offer with a deal, and leaves chosen deals alone", async () => {
    const o = await seedOrganisation(t.db, "deals-scaleo");
    const rows = await t.db
      .insert(links)
      .values([
        {
          organisationId: o,
          name: "Brand A UK",
          url: "https://example.scaletrk.com/click?o=1234&a=42&sub_id1={{dynamic}}",
        },
        {
          organisationId: o,
          name: "Brand A again",
          url: "https://trk.example-tracker.com/click?o=1234&a=42",
        },
        {
          organisationId: o,
          name: "No deal yet",
          url: "https://example.scaletrk.com/click?o=999&a=42",
        },
        {
          organisationId: o,
          name: "Chosen by hand",
          url: "https://example.scaletrk.com/click?o=1234&a=42",
          dealKey: "p|other",
        },
        { organisationId: o, name: "Not Scaleo", url: "https://example.com/?id={{dynamic}}" },
      ])
      .returning({ id: links.id, name: links.name });
    await saveBrandDeals(t.db, o, {
      deals: [
        {
          key: "scaleo:1234",
          program: "Example Partners",
          brand: "Brand A SMS",
          deal: "€150 CPA (Scaleo offer 1234)",
          topGeos: "",
          startsOn: null,
          cpaMicro: 150_000_000n,
          reason: null,
        },
      ],
      startsOn: "2026-11-01",
      uploadedBy: null,
    });
    expect(await linkOffersToScaleoDeals(t.db, o)).toBe(2);
    const offers = await listOffersWithDeals(t.db, o);
    expect(Object.fromEntries(offers.map((x) => [x.name, x.dealKey]))).toEqual({
      "Brand A UK": "scaleo:1234",
      "Brand A again": "scaleo:1234",
      "No deal yet": null,
      "Chosen by hand": "p|other",
      "Not Scaleo": null,
    });
    expect(rows).toHaveLength(5);
    expect(await linkOffersToScaleoDeals(t.db, o)).toBe(0);
  });
});
