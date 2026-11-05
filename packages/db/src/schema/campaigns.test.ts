import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  expectDbError,
  expectUniqueViolation,
  seedOrganisation,
  type TestDb,
} from "../test/db.js";
import {
  adTexts,
  campaignLinks,
  campaignLists,
  campaignSidGroup,
  campaigns,
  laps,
  links,
  senderIds,
  sidGroups,
} from "./campaigns.js";
import { lists } from "./lists.js";
import { routePrices, routes } from "./routes.js";

let t: TestDb;
let org: string;

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
});

afterAll(async () => {
  await t.close();
});

async function newCampaign(name: string): Promise<string> {
  const [row] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name, country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  if (!row) throw new Error("campaign insert returned no row");
  return row.id;
}

async function newList(name: string): Promise<string> {
  const [row] = await t.db
    .insert(lists)
    .values({ organisationId: org, name, country: "ES" })
    .returning({ id: lists.id });
  if (!row) throw new Error("list insert returned no row");
  return row.id;
}

describe("campaigns", () => {
  it("defaults to draft, account-wide reuse and a test size of 200", async () => {
    const [row] = await t.db
      .insert(campaigns)
      .values({ organisationId: org, name: "Roy Boy ES", country: "ES", timezone: "Europe/Madrid" })
      .returning();
    expect(row?.status).toBe("draft");
    expect(row?.contactReuse).toBe("account_wide");
    expect(row?.testSize).toBe(200);
    expect(row?.scheduledAt).toBeNull();
    expect(row?.createdBy).toBeNull();
  });

  it("rejects a status outside the enum", async () => {
    await expectDbError(
      t.db.execute(
        sql`insert into campaigns (organisation_id, name, country, timezone, status) values (${org}, 'x', 'ES', 'UTC', 'bogus')`,
      ),
      /invalid input value for enum campaign_status/,
    );
  });
});

describe("sender ids", () => {
  it("rejects the same value twice in one group but allows it in another", async () => {
    const [a] = await t.db
      .insert(sidGroups)
      .values({ organisationId: org, name: "ES", country: "ES" })
      .returning({ id: sidGroups.id });
    const [b] = await t.db
      .insert(sidGroups)
      .values({ organisationId: org, name: "FR", country: "FR" })
      .returning({ id: sidGroups.id });
    if (!a || !b) throw new Error("setup failed");

    await t.db
      .insert(senderIds)
      .values({ organisationId: org, sidGroupId: a.id, value: "LUCKY777" });
    await t.db
      .insert(senderIds)
      .values({ organisationId: org, sidGroupId: b.id, value: "LUCKY777" });
    await expectUniqueViolation(
      t.db.insert(senderIds).values({ organisationId: org, sidGroupId: a.id, value: "LUCKY777" }),
    );
  });
});

describe("campaign joins", () => {
  it("a list can be attached to a campaign only once", async () => {
    const campaignId = await newCampaign("joins");
    const listId = await newList("joins list");
    await t.db.insert(campaignLists).values({ campaignId, listId, organisationId: org });
    await expectUniqueViolation(
      t.db.insert(campaignLists).values({ campaignId, listId, organisationId: org }),
    );
  });

  it("a campaign has at most one sender id group", async () => {
    const campaignId = await newCampaign("sid group");
    const [g1] = await t.db
      .insert(sidGroups)
      .values({ organisationId: org, name: "g1", country: "ES" })
      .returning({ id: sidGroups.id });
    const [g2] = await t.db
      .insert(sidGroups)
      .values({ organisationId: org, name: "g2", country: "ES" })
      .returning({ id: sidGroups.id });
    if (!g1 || !g2) throw new Error("setup failed");
    await t.db
      .insert(campaignSidGroup)
      .values({ campaignId, sidGroupId: g1.id, organisationId: org });
    await expectUniqueViolation(
      t.db.insert(campaignSidGroup).values({ campaignId, sidGroupId: g2.id, organisationId: org }),
    );
  });

  it("a link can be attached to a campaign only once", async () => {
    const campaignId = await newCampaign("links");
    const [link] = await t.db
      .insert(links)
      .values({
        organisationId: org,
        name: "Trixino",
        url: "https://trk.example.com/click?o=75&a=35&sub_id1={{dynamic}}",
      })
      .returning({ id: links.id, active: links.active });
    if (!link) throw new Error("setup failed");
    expect(link.active).toBe(true);
    await t.db.insert(campaignLinks).values({ campaignId, linkId: link.id, organisationId: org });
    await expectUniqueViolation(
      t.db.insert(campaignLinks).values({ campaignId, linkId: link.id, organisationId: org }),
    );
  });

  it("ad texts are ordered by position within a campaign", async () => {
    const campaignId = await newCampaign("texts");
    await t.db.insert(adTexts).values([
      { organisationId: org, campaignId, text: "B", encoding: "GSM_7BIT", parts: 1, position: 2 },
      { organisationId: org, campaignId, text: "A", encoding: "GSM_7BIT", parts: 1, position: 1 },
    ]);
    const rows = await t.db.query.adTexts.findMany({
      where: (a, { eq }) => eq(a.campaignId, campaignId),
      orderBy: (a, { asc }) => asc(a.position),
    });
    expect(rows.map((r) => r.text)).toEqual(["A", "B"]);
    expect(rows.every((r) => r.active)).toBe(true);
  });
});

describe("laps", () => {
  it("starts queued with zeroed counters and a bigint cost", async () => {
    const campaignId = await newCampaign("laps");
    const listId = await newList("laps list");
    const [route] = await t.db
      .insert(routes)
      .values({ provider: "platform", name: "405", country: "ES" })
      .returning({ id: routes.id, organisationId: routes.organisationId });
    if (!route) throw new Error("setup failed");
    expect(route.organisationId).toBeNull();
    await t.db
      .insert(routePrices)
      .values({ routeId: route.id, country: "ES", priceMicro: 25_000n, validFrom: new Date() });

    const [lap] = await t.db
      .insert(laps)
      .values({ organisationId: org, campaignId, listId, routeId: route.id, testSize: 200 })
      .returning();
    expect(lap?.status).toBe("queued");
    expect(lap?.sent).toBe(0);
    expect(lap?.costMicro).toBe(0n);
    expect(lap?.rank).toBeNull();
  });
});
