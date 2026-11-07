import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { campaigns, contacts, laps, lists, messages, routes } from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  addSuppressions,
  createSuppressionImport,
  listSuppressionImports,
  listSuppressions,
  removeSuppressions,
  suppressByDynamicId,
  suppressionStats,
} from "./suppressions.js";

let t: TestDb;
let org: string;
let other: string;

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  other = await seedOrganisation(t.db, "org-b");
  // One sent message with a dynamic id, for the by-dynamic unsubscribe.
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
  const [contact] = await t.db
    .insert(contacts)
    .values({ organisationId: org, e164: "+34622000009", country: "ES" })
    .returning({ id: contacts.id });
  if (!campaign || !list || !route || !contact) throw new Error("seed failed");
  const [lap] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId: campaign.id,
      listId: list.id,
      routeId: route.id,
      testSize: 1,
    })
    .returning({ id: laps.id });
  if (!lap) throw new Error("seed failed");
  await t.db.insert(messages).values({
    organisationId: org,
    campaignId: campaign.id,
    lapId: lap.id,
    contactId: contact.id,
    e164: "+34622000009",
    senderId: "SID",
    text: "hi",
    encoding: "GSM_7BIT",
    parts: 1,
    routeId: route.id,
    status: "sent",
    dynamicId: "dyn-unsub-1",
    idempotencyKey: "sup:1",
    sentAt: new Date(),
  });
});

afterAll(async () => {
  await t.close();
});

describe("suppressions", () => {
  it("adds numbers once, lists them newest first and searches by digits", async () => {
    const added = await addSuppressions(t.db, org, {
      numbers: [
        { e164: "+34622000001", country: "ES" },
        { e164: "+447911123456", country: "GB" },
        { e164: "+34622000001", country: "ES" },
      ],
      source: "manual",
    });
    expect(added).toBe(2);
    expect(
      await addSuppressions(t.db, org, {
        numbers: [{ e164: "+34622000001", country: "ES" }],
        source: "manual",
      }),
    ).toBe(0);
    const page = await listSuppressions(t.db, org, { page: 1, pageSize: 10 });
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.e164).sort()).toEqual(["+34622000001", "+447911123456"]);
    expect(page.rows.find((r) => r.e164 === "+447911123456")).toMatchObject({
      country: "GB",
      source: "manual",
    });
    const search = await listSuppressions(t.db, org, { search: "622 000", page: 1, pageSize: 10 });
    expect(search.rows.map((r) => r.e164)).toEqual(["+34622000001"]);
    expect((await listSuppressions(t.db, other, { page: 1, pageSize: 10 })).total).toBe(0);
  });

  it("imports are recorded and counted, and resubscribe removes numbers", async () => {
    const job = await createSuppressionImport(t.db, org, {
      fileName: "unsubs.csv",
      count: 1,
      rejected: 0,
    });
    await addSuppressions(t.db, org, {
      numbers: [{ e164: "+34622000002", country: "ES" }],
      source: "upload",
      importId: job.id,
    });
    expect(await suppressionStats(t.db, org)).toEqual({ numbers: 3, imports: 1 });
    expect((await listSuppressionImports(t.db, org)).map((j) => j.fileName)).toEqual([
      "unsubs.csv",
    ]);
    expect(await removeSuppressions(t.db, other, ["+34622000002"])).toBe(0);
    expect(await removeSuppressions(t.db, org, ["+34622000002", "+34622000001"])).toBe(2);
    expect(await suppressionStats(t.db, org)).toEqual({ numbers: 1, imports: 1 });
  });

  it("suppresses by dynamic id within the organisation only", async () => {
    expect(await suppressByDynamicId(t.db, other, "dyn-unsub-1")).toBeNull();
    expect(await suppressByDynamicId(t.db, org, "dyn-unsub-1")).toEqual({
      e164: "+34622000009",
      added: true,
    });
    expect(await suppressByDynamicId(t.db, org, "dyn-unsub-1")).toEqual({
      e164: "+34622000009",
      added: false,
    });
    const page = await listSuppressions(t.db, org, { search: "622000009", page: 1, pageSize: 5 });
    expect(page.rows[0]).toMatchObject({ source: "api", country: null });
  });
});
