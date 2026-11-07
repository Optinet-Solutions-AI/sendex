import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { campaigns, contacts, laps, lists, postbacks, routes } from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { getDashboardTotals } from "./dashboard.js";

let t: TestDb;
let org: string;
let other: string;

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  other = await seedOrganisation(t.db, "org-b");
  await t.db.insert(contacts).values([
    { organisationId: org, e164: "+34600000001", country: "ES" },
    { organisationId: org, e164: "+34600000002", country: "ES" },
    { organisationId: other, e164: "+34600000003", country: "ES" },
  ]);
  const [campaign] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "c", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "l", country: "ES" })
    .returning({ id: lists.id });
  const [route] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "405", country: "ES" })
    .returning({ id: routes.id });
  if (!campaign || !list || !route) throw new Error("seed failed");
  await t.db.insert(laps).values([
    {
      organisationId: org,
      campaignId: campaign.id,
      listId: list.id,
      routeId: route.id,
      testSize: 10,
      status: "done",
      sent: 120,
      costMicro: 3_000_000n,
    },
    {
      organisationId: org,
      campaignId: campaign.id,
      listId: list.id,
      routeId: route.id,
      testSize: 10,
      status: "done",
      sent: 80,
      costMicro: 2_000_000n,
    },
  ]);
  await t.db.insert(postbacks).values([
    { organisationId: org, eventKey: "k1", dynamicId: "d1", type: "sale", campaignId: campaign.id },
    { organisationId: org, eventKey: "k2", dynamicId: "d2", type: "lead", campaignId: campaign.id },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("getDashboardTotals", () => {
  it("counts contacts, sent messages, spend and sales for one organisation", async () => {
    await expect(getDashboardTotals(t.db, org)).resolves.toEqual({
      contacts: 2,
      sent: 200,
      spendMicro: 5_000_000n,
      sales: 1,
    });
  });

  it("is zero for an organisation without activity", async () => {
    await expect(getDashboardTotals(t.db, other)).resolves.toEqual({
      contacts: 1,
      sent: 0,
      spendMicro: 0n,
      sales: 0,
    });
  });
});
