import type { SegmentGroup } from "@sendex/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaigns,
  clicks,
  contacts,
  laps,
  listMembers,
  lists,
  messages,
  postbacks,
  routes,
  suppressions,
} from "../schema/index.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  createSegment,
  deleteSegment,
  duplicateSegment,
  getSegment,
  globalExcludeCondition,
  listSegments,
  previewSegment,
  refreshSegmentStats,
  segmentNumbers,
  updateSegment,
} from "./segments.js";

let t: TestDb;
let org: string;
let other: string;
let listA: string;
let listB: string;
let campaignId: string;

const AT = new Date("2026-11-01T09:00:00Z");

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  other = await seedOrganisation(t.db, "org-b");
  const [a] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "Roy Boy_ES_Batch2", country: "ES" })
    .returning({ id: lists.id });
  const [b] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "Roy Boy_UK_Batch3", country: "GB" })
    .returning({ id: lists.id });
  const [campaign] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "ES casino", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [route] = await t.db
    .insert(routes)
    .values({ provider: "fake", name: "405", country: "ES" })
    .returning({ id: routes.id });
  if (!a || !b || !campaign || !route) throw new Error("seed failed");
  listA = a.id;
  listB = b.id;
  campaignId = campaign.id;
  const [lap] = await t.db
    .insert(laps)
    .values({ organisationId: org, campaignId, listId: listA, routeId: route.id, testSize: 3 })
    .returning({ id: laps.id });
  if (!lap) throw new Error("seed failed");

  // ES: three contacts; the first clicked (mobile, Vodafone) and converted, the second only
  // received, the third was never sent. GB: one contact in list B. Another organisation: one ES.
  const seeds = [
    { e164: "+34622000001", country: "ES", listId: listA, sent: true, clicked: true, lead: true },
    { e164: "+34622000002", country: "ES", listId: listA, sent: true, clicked: false, lead: false },
    {
      e164: "+34622000003",
      country: "ES",
      listId: listA,
      sent: false,
      clicked: false,
      lead: false,
    },
    {
      e164: "+447911123456",
      country: "GB",
      listId: listB,
      sent: false,
      clicked: false,
      lead: false,
    },
  ];
  for (const s of seeds) {
    const [contact] = await t.db
      .insert(contacts)
      .values({
        organisationId: org,
        e164: s.e164,
        country: s.country,
        firstName: s.e164.slice(-1),
      })
      .returning({ id: contacts.id });
    if (!contact) throw new Error("seed failed");
    await t.db.insert(listMembers).values({
      organisationId: org,
      listId: s.listId,
      contactId: contact.id,
      sentAt: s.sent ? AT : null,
    });
    if (!s.sent) continue;
    const [message] = await t.db
      .insert(messages)
      .values({
        organisationId: org,
        campaignId,
        lapId: lap.id,
        contactId: contact.id,
        e164: s.e164,
        senderId: "SID",
        text: "hi",
        encoding: "GSM_7BIT",
        parts: 1,
        routeId: route.id,
        status: "delivered",
        idempotencyKey: `seg:${s.e164}`,
        sentAt: AT,
      })
      .returning({ id: messages.id });
    if (!message) throw new Error("seed failed");
    if (s.clicked) {
      await t.db.insert(clicks).values({
        organisationId: org,
        messageId: message.id,
        campaignId,
        lapId: lap.id,
        at: new Date(AT.getTime() + 60_000),
        device: "mobile",
        operator: "Vodafone Spain",
        country: "ES",
      });
    }
    if (s.lead) {
      await t.db.insert(postbacks).values({
        organisationId: org,
        eventKey: `lead:${s.e164}`,
        type: "lead",
        dynamicId: `dyn:${s.e164}`,
        messageId: message.id,
        campaignId,
        lapId: lap.id,
      });
    }
  }
  await t.db.insert(suppressions).values({
    organisationId: org,
    e164: "+34622000003",
    reason: "unsubscribed",
    source: "manual",
  });
  const [foreign] = await t.db
    .insert(contacts)
    .values({ organisationId: other, e164: "+34622000099", country: "ES" })
    .returning({ id: contacts.id });
  const [foreignList] = await t.db
    .insert(lists)
    .values({ organisationId: other, name: "x", country: "ES" })
    .returning({ id: lists.id });
  if (!foreign || !foreignList) throw new Error("seed failed");
  await t.db
    .insert(listMembers)
    .values({ organisationId: other, listId: foreignList.id, contactId: foreign.id });
});

afterAll(async () => {
  await t.close();
});

const rule = (id: string, field: string, operator: string, value?: unknown) => ({
  id,
  field,
  operator,
  ...(value === undefined ? {} : { value }),
});

describe("previewSegment", () => {
  it("country equals ES: three contacts, two good (one is unsubscribed), with breakdowns", async () => {
    const preview = await previewSegment(t.db, org, {
      id: "g",
      op: "and",
      rules: [rule("r1", "country", "equals", "ES")],
    });
    expect(preview).toMatchObject({ total: 3, good: 2, cached: 0 });
    expect(preview.sample).toHaveLength(3);
    expect(preview.sample.every((s) => s.endsWith("****"))).toBe(true);
    expect(preview.countries).toEqual([{ key: "ES", count: 3 }]);
    expect(preview.networks).toEqual([{ key: "Vodafone Spain", count: 1 }]);
    expect(preview.devices).toEqual([{ key: "mobile", count: 1 }]);
  });

  it("engagement, recency, campaign activity and list rules narrow the audience", async () => {
    const count = async (rules: SegmentGroup["rules"], op: "and" | "or" = "and") =>
      (await previewSegment(t.db, org, { id: "g", op, rules }, { sample: 0 })).total;
    expect(await count([rule("a", "clicks_count", "gt", 0)])).toBe(1);
    expect(await count([rule("a", "sent_count", "equals", 0)])).toBe(2);
    expect(await count([rule("a", "ctr_level", "gte", 50)])).toBe(1);
    expect(await count([rule("a", "leads", "gte", 1)])).toBe(1);
    expect(await count([rule("a", "dlr_delivered", "gte", 1)])).toBe(2);
    expect(await count([rule("a", "last_clicked", "is_set")])).toBe(1);
    expect(await count([rule("a", "last_received_sms", "after", "2026-10-31")])).toBe(2);
    expect(await count([rule("a", "last_received_sms", "before", "2026-10-31")])).toBe(0);
    expect(await count([rule("a", "sent_in_campaign", "in", [campaignId])])).toBe(2);
    expect(await count([rule("a", "lead_in_campaign", "equals", campaignId)])).toBe(1);
    expect(await count([rule("a", "list", "in", [listB])])).toBe(1);
    expect(await count([rule("a", "list", "not_in", [listA])])).toBe(1);
    expect(await count([rule("a", "list_name", "contains", "uk")])).toBe(1);
    expect(await count([rule("a", "device", "equals", "mobile")])).toBe(1);
    expect(await count([rule("a", "mobile_network", "in", ["Vodafone Spain"])])).toBe(1);
    expect(await count([rule("a", "first_name", "equals", "1")])).toBe(1);
    expect(await count([rule("a", "email", "is_not_set")])).toBe(4);
    expect(
      await count([rule("a", "country", "equals", "GB"), rule("b", "clicks_count", "gt", 0)], "or"),
    ).toBe(2);
    expect(
      await count([
        rule("a", "country", "equals", "ES"),
        {
          id: "g2",
          op: "or",
          rules: [rule("b", "leads", "gte", 1), rule("c", "sent_count", "equals", 0)],
        },
      ]),
    ).toBe(2);
  });

  it("an empty tree matches nothing and an invalid tree is refused", async () => {
    expect((await previewSegment(t.db, org, { id: "g", op: "and", rules: [] })).total).toBe(0);
    await expect(
      previewSegment(t.db, org, { id: "g", op: "and", rules: [rule("a", "country", "equals")] }),
    ).rejects.toThrow("Rule 1 (Country): missing value");
  });

  it("never reaches across organisations", async () => {
    const preview = await previewSegment(t.db, other, {
      id: "g",
      op: "and",
      rules: [rule("r1", "country", "equals", "ES")],
    });
    expect(preview.total).toBe(1);
    expect(
      await segmentNumbers(
        t.db,
        other,
        { id: "g", op: "and", rules: [rule("r1", "country", "equals", "ES")] },
        { page: 1, pageSize: 10 },
      ),
    ).toEqual(["+34622000099"]);
  });
});

describe("segments CRUD", () => {
  it("creates with a summary, lists per tab, refreshes stats, duplicates and deletes", async () => {
    const created = await createSegment(t.db, org, {
      name: "ES clickers",
      definition: {
        id: "g",
        op: "and",
        rules: [rule("a", "country", "equals", "ES"), rule("b", "clicks_count", "gt", 0)],
      },
      isTemplate: false,
      globalExclude: false,
    });
    expect(created.summary).toBe("Country equals ES and Clicks Count > 0");
    expect(created.size).toBeNull();

    await createSegment(t.db, org, {
      name: "Template",
      definition: { id: "g", op: "and", rules: [rule("a", "sent_count", "gte", 5)] },
      isTemplate: true,
      globalExclude: false,
    });
    const excluded = await createSegment(t.db, org, {
      name: "Never again",
      definition: { id: "g", op: "and", rules: [rule("a", "list", "in", [listB])] },
      isTemplate: false,
      globalExclude: true,
    });

    const all = await listSegments(t.db, org, { tab: "all" });
    expect(all.counts).toEqual({ all: 3, templates: 1, excludes: 1 });
    expect(all.rows.map((r) => r.name)).toEqual(["Never again", "Template", "ES clickers"]);
    expect((await listSegments(t.db, org, { tab: "templates" })).rows.map((r) => r.name)).toEqual([
      "Template",
    ]);
    expect((await listSegments(t.db, org, { tab: "excludes" })).rows.map((r) => r.name)).toEqual([
      "Never again",
    ]);
    expect((await listSegments(t.db, org, { tab: "all", search: "click" })).rows).toHaveLength(1);
    expect((await listSegments(t.db, other, { tab: "all" })).counts.all).toBe(0);

    expect(await refreshSegmentStats(t.db, org)).toBe(3);
    const refreshed = await getSegment(t.db, org, created.id);
    expect(refreshed).toMatchObject({ size: 1, good: 1 });
    expect(refreshed?.statsAt).toBeInstanceOf(Date);

    const updated = await updateSegment(t.db, org, created.id, {
      name: "ES clickers v2",
      definition: { id: "g", op: "and", rules: [rule("a", "country", "equals", "ES")] },
      isTemplate: false,
      globalExclude: false,
    });
    expect(updated).toMatchObject({
      name: "ES clickers v2",
      summary: "Country equals ES",
      size: null,
    });
    await expect(
      updateSegment(t.db, other, created.id, {
        name: "x",
        definition: { id: "g", op: "and", rules: [] },
        isTemplate: false,
        globalExclude: false,
      }),
    ).rejects.toThrow(/not found/i);

    const copy = await duplicateSegment(t.db, org, excluded.id);
    expect(copy).toMatchObject({ name: "Copy of Never again", globalExclude: false });

    const condition = await globalExcludeCondition(t.db, org);
    expect(condition).not.toBeNull();
    expect(await globalExcludeCondition(t.db, other)).toBeNull();

    expect(await deleteSegment(t.db, other, copy.id)).toBe(false);
    expect(await deleteSegment(t.db, org, copy.id)).toBe(true);
    expect((await listSegments(t.db, org, { tab: "all" })).counts.all).toBe(3);
  });
});
