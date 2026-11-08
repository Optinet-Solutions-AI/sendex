import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, contacts, listMembers, lists, suppressions } from "../schema/index.js";
import { routePrices, routes } from "../schema/routes.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { listAuditLog } from "./audit.js";
import {
  addAdTexts,
  addSenderIds,
  attachLink,
  createCampaign,
  createLaps,
  createLink,
  createSidGroup,
  deleteCampaign,
  detachLink,
  duplicateCampaign,
  estimateSend,
  getCampaign,
  listCampaigns,
  listLinks,
  listSidGroups,
  listsForCountry,
  routesForCountry,
  setCampaignLists,
  setCampaignSegments,
  setCampaignSidGroup,
  toggleAdText,
  toggleCampaignLink,
  toggleSenderId,
  updateAdText,
  updateSendSettings,
} from "./campaigns.js";
import { createSegment } from "./segments.js";

let t: TestDb;
let orgA: string;
let orgB: string;
let listEs: string;
let listFr: string;
let route405: string;
let route403: string;
let customRoute: string;

async function seedList(org: string, name: string, country: string, prefix: string, n: number) {
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name, country, numbersCount: n })
    .returning({ id: lists.id });
  if (!list) throw new Error("list insert failed");
  const contactRows = await t.db
    .insert(contacts)
    .values(
      Array.from({ length: n }, (_, i) => ({
        organisationId: org,
        e164: `${prefix}${String(100 + i)}`,
        country,
      })),
    )
    .returning({ id: contacts.id, e164: contacts.e164 });
  await t.db.insert(listMembers).values(
    contactRows.map((c) => ({
      organisationId: org,
      listId: list.id,
      contactId: c.id,
    })),
  );
  return { id: list.id, contacts: contactRows };
}

async function seedRoute(name: string, country: string, priceMicro: bigint, org?: string) {
  const [route] = await t.db
    .insert(routes)
    .values({ organisationId: org ?? null, provider: org ? "smpp" : "platform", name, country })
    .returning({ id: routes.id });
  if (!route) throw new Error("route insert failed");
  await t.db.insert(routePrices).values([
    {
      routeId: route.id,
      country,
      priceMicro: priceMicro + 10_000n,
      validFrom: new Date("2025-01-01T00:00:00Z"),
    },
    { routeId: route.id, country, priceMicro, validFrom: new Date("2026-01-01T00:00:00Z") },
  ]);
  return route.id;
}

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");

  // 10 members: 2 already sent, 1 bad, 1 sent then flushed (available again), 1 sent after a
  // flush, 1 suppressed -> 5 available.
  const es = await seedList(orgA, "Roy Boy_ES", "ES", "+34600000", 10);
  listEs = es.id;
  const [c0, c1, c2, c3, c4] = es.contacts;
  if (!c0 || !c1 || !c2 || !c3 || !c4) throw new Error("setup failed");
  await t.db
    .update(listMembers)
    .set({ sentAt: new Date() })
    .where(eq(listMembers.contactId, c0.id));
  await t.db
    .update(listMembers)
    .set({ sentAt: new Date() })
    .where(eq(listMembers.contactId, c1.id));
  await t.db.update(listMembers).set({ bad: true }).where(eq(listMembers.contactId, c2.id));
  const [c5] = es.contacts.slice(5);
  if (!c5) throw new Error("setup failed");
  await t.db
    .update(listMembers)
    .set({ sentAt: new Date(Date.now() - 60_000), flushedAt: new Date() })
    .where(eq(listMembers.contactId, c3.id));
  await t.db
    .update(listMembers)
    .set({ sentAt: new Date(), flushedAt: new Date(Date.now() - 60_000) })
    .where(eq(listMembers.contactId, c5.id));
  await t.db
    .insert(suppressions)
    .values({ organisationId: orgA, e164: c4.e164, reason: "unsubscribe", source: "sms" });

  const fr = await seedList(orgA, "Roy Boy_FR", "FR", "+33600000", 3);
  listFr = fr.id;
  await seedList(orgB, "Other org ES", "ES", "+34700000", 2);

  route405 = await seedRoute("405", "ES", 25_000n);
  route403 = await seedRoute("403", "ES", 27_000n);
  await seedRoute("375", "FR", 35_700n);
  customRoute = await seedRoute("23Telecom", "ES", 20_000n, orgA);
  await seedRoute("OtherOrgRoute", "ES", 1n, orgB);
});

afterAll(async () => {
  await t.close();
});

describe("createCampaign and listCampaigns", () => {
  it("creates a draft and lists it with zero aggregates and the total count", async () => {
    const created = await createCampaign(t.db, orgA, {
      name: "Roy Boy ES",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    expect(created.status).toBe("draft");
    expect(created.testSize).toBe(200);

    const page = await listCampaigns(t.db, orgA, { page: 1 });
    expect(page.total).toBeGreaterThanOrEqual(1);
    const row = page.items.find((c) => c.id === created.id);
    expect(row).toMatchObject({
      name: "Roy Boy ES",
      country: "ES",
      status: "draft",
      lapsCount: 0,
      sent: 0,
      clicks: 0,
      ctr: 0,
      costMicro: 0n,
      leads: 0,
      sales: 0,
      firstLapAt: null,
      lastLapAt: null,
    });

    const other = await listCampaigns(t.db, orgB, { page: 1 });
    expect(other.items.find((c) => c.id === created.id)).toBeUndefined();
    expect(await getCampaign(t.db, orgB, created.id)).toBeNull();
  });

  it("filters by search, country and status", async () => {
    await createCampaign(t.db, orgA, { name: "Zed FR", country: "FR", timezone: "Europe/Paris" });
    const bySearch = await listCampaigns(t.db, orgA, { page: 1, search: "zed" });
    expect(bySearch.items.map((c) => c.name)).toEqual(["Zed FR"]);
    const byCountry = await listCampaigns(t.db, orgA, { page: 1, countries: ["fr"] });
    expect(byCountry.items.every((c) => c.country === "FR")).toBe(true);
    const byStatus = await listCampaigns(t.db, orgA, { page: 1, status: "completed" });
    expect(byStatus.items).toEqual([]);
    expect(byStatus.total).toBe(0);
  });
});

describe("sender id groups", () => {
  it("creates a group, dedupes added ids and toggles one", async () => {
    const group = await createSidGroup(t.db, orgA, { name: "ES Casino", country: "ES" });
    const first = await addSenderIds(t.db, orgA, group.id, ["LUCKY777", "BONUS777", "LUCKY777"]);
    expect(first.added).toBe(2);
    const second = await addSenderIds(t.db, orgA, group.id, ["BONUS777", "VIPCLUB"]);
    expect(second.added).toBe(1);

    const groups = await listSidGroups(t.db, orgA, "ES");
    const found = groups.find((g) => g.id === group.id);
    expect(found?.senderIds.map((s) => s.value)).toEqual(["BONUS777", "LUCKY777", "VIPCLUB"]);

    const lucky = found?.senderIds.find((s) => s.value === "LUCKY777");
    if (!lucky) throw new Error("missing sender id");
    await toggleSenderId(t.db, orgA, lucky.id, false);
    const after = (await listSidGroups(t.db, orgA, "ES")).find((g) => g.id === group.id);
    expect(after?.senderIds.find((s) => s.value === "LUCKY777")?.active).toBe(false);
    expect(after?.activeCount).toBe(2);

    expect(await listSidGroups(t.db, orgB, "ES")).toEqual([]);
  });
});

describe("campaign detail: lists, sids, texts, links", () => {
  it("assembles the detail with available counts per list", async () => {
    const campaign = await createCampaign(t.db, orgA, {
      name: "Detail",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    const group = await createSidGroup(t.db, orgA, { name: "Detail SIDs", country: "ES" });
    await addSenderIds(t.db, orgA, group.id, ["AAA111", "BBB222"]);
    await setCampaignSidGroup(t.db, orgA, campaign.id, group.id);
    await setCampaignLists(t.db, orgA, campaign.id, [listEs]);

    const texts = await addAdTexts(
      t.db,
      orgA,
      campaign.id,
      "Win big at {{domain}}\n//\nUnete hoy {{domain}} €€",
    );
    expect(texts.map((x) => [x.encoding, x.parts, x.position])).toEqual([
      ["GSM_7BIT", 1, 0],
      ["GSM_7BIT", 1, 1],
    ]);

    const link = await createLink(t.db, orgA, {
      name: "Trixino",
      url: "https://trk.example.com/click?sub_id1={{dynamic}}",
    });
    await attachLink(t.db, orgA, campaign.id, link.id);
    await toggleCampaignLink(t.db, orgA, campaign.id, link.id, false);

    const detail = await getCampaign(t.db, orgA, campaign.id);
    if (!detail) throw new Error("campaign not found");
    expect(detail.lists).toEqual([
      expect.objectContaining({ id: listEs, name: "Roy Boy_ES", available: 5, numbersCount: 10 }),
    ]);
    expect(detail.sidGroup?.name).toBe("Detail SIDs");
    expect(detail.sidGroup?.senderIds.map((s) => s.value)).toEqual(["AAA111", "BBB222"]);
    expect(detail.adTexts).toHaveLength(2);
    expect(detail.links).toEqual([
      expect.objectContaining({ id: link.id, name: "Trixino", active: false }),
    ]);
    expect(detail.laps).toEqual([]);

    const firstText = detail.adTexts[0];
    if (!firstText) throw new Error("missing text");
    const updated = await updateAdText(t.db, orgA, firstText.id, "Ú".repeat(80));
    expect(updated.encoding).toBe("UCS2");
    expect(updated.parts).toBe(2);
    await toggleAdText(t.db, orgA, firstText.id, false);
    const again = await getCampaign(t.db, orgA, campaign.id);
    expect(again?.adTexts[0]?.active).toBe(false);

    await detachLink(t.db, orgA, campaign.id, link.id);
    expect((await getCampaign(t.db, orgA, campaign.id))?.links).toEqual([]);
    expect((await listLinks(t.db, orgA)).some((l) => l.id === link.id)).toBe(true);
    expect((await listLinks(t.db, orgB)).some((l) => l.id === link.id)).toBe(false);

    // Replacing the lists drops the ones no longer selected.
    await setCampaignLists(t.db, orgA, campaign.id, [listFr]);
    expect((await getCampaign(t.db, orgA, campaign.id))?.lists.map((l) => l.id)).toEqual([listFr]);

    const esLists = await listsForCountry(t.db, orgA, "ES");
    expect(esLists).toEqual([expect.objectContaining({ id: listEs, available: 5 })]);
  });

  it("rejects a sid group of another organisation", async () => {
    const campaign = await createCampaign(t.db, orgA, {
      name: "Tenancy",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    const foreign = await createSidGroup(t.db, orgB, { name: "B", country: "ES" });
    await expect(setCampaignSidGroup(t.db, orgA, campaign.id, foreign.id)).rejects.toThrow();
  });
});

describe("routesForCountry", () => {
  it("returns platform routes priced for the country plus the organisation's own routes", async () => {
    const es = await routesForCountry(t.db, orgA, "ES");
    expect(es.map((r) => [r.name, r.priceMicro, r.platform])).toEqual([
      ["23Telecom", 20_000n, false],
      ["403", 27_000n, true],
      ["405", 25_000n, true],
    ]);
    const fr = await routesForCountry(t.db, orgA, "FR");
    expect(fr.map((r) => [r.name, r.priceMicro])).toEqual([
      ["23Telecom", null],
      ["375", 35_700n],
    ]);
  });
});

describe("estimateSend and createLaps", () => {
  it("estimates test laps per list and route and queues them on send", async () => {
    const campaign = await createCampaign(t.db, orgA, {
      name: "Send me",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    const group = await createSidGroup(t.db, orgA, { name: "Send SIDs", country: "ES" });
    await addSenderIds(t.db, orgA, group.id, ["AAA111", "BBB222", "CCC333"]);
    await setCampaignSidGroup(t.db, orgA, campaign.id, group.id);
    await setCampaignLists(t.db, orgA, campaign.id, [listEs]);
    await addAdTexts(t.db, orgA, campaign.id, "Hello {{domain}}");
    const link = await createLink(t.db, orgA, { name: "L", url: "https://x.example/{{dynamic}}" });
    await attachLink(t.db, orgA, campaign.id, link.id);
    await updateSendSettings(t.db, orgA, campaign.id, {
      testSize: 3,
      contactReuse: "per_campaign",
      sendNow: true,
    });

    const estimate = await estimateSend(t.db, orgA, campaign.id, {
      routeIds: [route405, route403],
      sendAll: false,
    });
    expect(estimate).toMatchObject({
      contacts: 5,
      sids: 3,
      texts: 1,
      links: 1,
      testSize: 3,
      smsCount: 6,
      costMicro: 3n * 25_000n + 3n * 27_000n,
    });
    expect(estimate.laps).toEqual([
      { listId: listEs, routeId: route405, count: 3, costMicro: 75_000 },
      { listId: listEs, routeId: route403, count: 3, costMicro: 81_000 },
    ]);

    const all = await estimateSend(t.db, orgA, campaign.id, {
      routeIds: [route405, route403],
      sendAll: true,
    });
    expect(all.smsCount).toBe(5);
    expect(all.laps.map((l) => l.count)).toEqual([3, 2]);

    const laps = await createLaps(t.db, orgA, campaign.id, {
      routeIds: [route405, route403],
      sendAll: false,
      actorUserId: null,
    });
    expect(laps.map((l) => [l.routeId, l.testSize, l.status])).toEqual([
      [route405, 3, "queued"],
      [route403, 3, "queued"],
    ]);
    // Laps queued together share a timestamp; the detail orders them by list then route name.

    const detail = await getCampaign(t.db, orgA, campaign.id);
    expect(detail?.status).toBe("sending");
    expect(detail?.laps.map((l) => l.routeName)).toEqual(["403", "405"]);

    const audit = await listAuditLog(t.db, orgA, { targetType: "campaign", targetId: campaign.id });
    expect(audit.map((a) => a.action)).toContain("campaign.send");
    const [auditRow] = await t.db.select().from(auditLog).where(eq(auditLog.targetId, campaign.id));
    expect(auditRow?.details).toMatchObject({ smsCount: 6, routeIds: [route405, route403] });

    const listed = (await listCampaigns(t.db, orgA, { page: 1 })).items.find(
      (c) => c.id === campaign.id,
    );
    expect(listed?.lapsCount).toBe(2);
    expect(listed?.firstLapAt).toBeInstanceOf(Date);

    await expect(deleteCampaign(t.db, orgA, campaign.id)).rejects.toThrow(/draft/);
  });

  it("refuses to send without lists, routes or an active text", async () => {
    const campaign = await createCampaign(t.db, orgA, {
      name: "Empty",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    await expect(
      createLaps(t.db, orgA, campaign.id, { routeIds: [route405], sendAll: false }),
    ).rejects.toThrow(/list/);
    await setCampaignLists(t.db, orgA, campaign.id, [listEs]);
    await expect(
      createLaps(t.db, orgA, campaign.id, { routeIds: [], sendAll: false }),
    ).rejects.toThrow(/route/);
    await expect(
      createLaps(t.db, orgA, campaign.id, { routeIds: [route405], sendAll: false }),
    ).rejects.toThrow(/text/);
  });

  it("ignores routes the organisation cannot use", async () => {
    const campaign = await createCampaign(t.db, orgA, {
      name: "Routes",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    await setCampaignLists(t.db, orgA, campaign.id, [listEs]);
    const [foreign] = await t.db
      .select({ id: routes.id })
      .from(routes)
      .where(eq(routes.name, "OtherOrgRoute"));
    if (!foreign) throw new Error("setup failed");
    const estimate = await estimateSend(t.db, orgA, campaign.id, {
      routeIds: [foreign.id, customRoute],
      sendAll: false,
    });
    expect(estimate.routes.map((r) => r.name)).toEqual(["23Telecom"]);
  });

  it("prices each message at the parts of the longest active text with the real link", async () => {
    const campaign = await createCampaign(t.db, orgA, {
      name: "Long texts",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    await setCampaignLists(t.db, orgA, campaign.id, [listEs]);
    // 141 characters as typed; over 160 once {{domain}} is a 30-character link.
    await addAdTexts(
      t.db,
      orgA,
      campaign.id,
      `Short {{domain}}
//
${"a".repeat(130)} {{domain}}`,
    );
    const link = await createLink(t.db, orgA, { name: "L2", url: "https://x.example/{{dynamic}}" });
    await attachLink(t.db, orgA, campaign.id, link.id);
    await updateSendSettings(t.db, orgA, campaign.id, {
      testSize: 3,
      contactReuse: "per_campaign",
      sendNow: true,
    });
    const estimate = await estimateSend(t.db, orgA, campaign.id, {
      routeIds: [route405],
      sendAll: false,
      linkLength: 30,
    });
    expect(estimate.smsCount).toBe(3);
    expect(estimate.costMicro).toBe(3n * 2n * 25_000n);
    expect(estimate.laps).toEqual([
      { listId: listEs, routeId: route405, count: 3, costMicro: 150_000 },
    ]);
  });
});

describe("duplicateCampaign and deleteCampaign", () => {
  it("copies lists, sid group, texts, links and settings into a new draft", async () => {
    const campaign = await createCampaign(t.db, orgA, {
      name: "Original",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    const group = await createSidGroup(t.db, orgA, { name: "Dup SIDs", country: "ES" });
    await setCampaignSidGroup(t.db, orgA, campaign.id, group.id);
    await setCampaignLists(t.db, orgA, campaign.id, [listEs, listFr]);
    await addAdTexts(t.db, orgA, campaign.id, "A\n//\nB");
    const link = await createLink(t.db, orgA, { name: "Dup", url: "https://d.example/" });
    await attachLink(t.db, orgA, campaign.id, link.id);
    await updateSendSettings(t.db, orgA, campaign.id, {
      testSize: 50,
      contactReuse: "per_campaign",
      sendNow: false,
      scheduledAt: "2030-01-01T10:00:00.000Z",
    });

    const copy = await duplicateCampaign(t.db, orgA, campaign.id);
    expect(copy.name).toBe("Copy of Original");
    expect(copy.status).toBe("draft");
    expect(copy.testSize).toBe(50);
    expect(copy.contactReuse).toBe("per_campaign");
    expect(copy.scheduledAt).toBeNull();

    const detail = await getCampaign(t.db, orgA, copy.id);
    expect(detail?.lists.map((l) => l.id).sort()).toEqual([listEs, listFr].sort());
    expect(detail?.sidGroup?.id).toBe(group.id);
    expect(detail?.adTexts.map((x) => x.text)).toEqual(["A", "B"]);
    expect(detail?.links.map((l) => l.id)).toEqual([link.id]);

    expect(await deleteCampaign(t.db, orgA, copy.id)).toBe(true);
    expect(await getCampaign(t.db, orgA, copy.id)).toBeNull();
    expect(await deleteCampaign(t.db, orgB, campaign.id)).toBe(false);
    await expect(duplicateCampaign(t.db, orgB, campaign.id)).rejects.toThrow(/not found/);
  });
});

describe("segment audiences", () => {
  it("plans one lap per list the matching contacts live in, limited to the segment", async () => {
    const campaign = await createCampaign(t.db, orgA, {
      name: "Segment send",
      country: "ES",
      timezone: "Europe/Madrid",
    });
    const group = await createSidGroup(t.db, orgA, { name: "Seg SIDs", country: "ES" });
    await addSenderIds(t.db, orgA, group.id, ["SEG111"]);
    await setCampaignSidGroup(t.db, orgA, campaign.id, group.id);
    await addAdTexts(t.db, orgA, campaign.id, "Hola {{domain}}");
    const segment = await createSegment(t.db, orgA, {
      name: "Spain",
      definition: {
        id: "g",
        op: "and",
        rules: [{ id: "r", field: "country", operator: "equals", value: "ES" }],
      },
      isTemplate: false,
      globalExclude: false,
    });
    await setCampaignSegments(t.db, orgA, campaign.id, [segment.id]);

    const detail = await getCampaign(t.db, orgA, campaign.id);
    expect(detail?.segments.map((s) => [s.name, s.available])).toEqual([["Spain", 5]]);

    const estimate = await estimateSend(t.db, orgA, campaign.id, {
      routeIds: [route405],
      sendAll: false,
    });
    expect(estimate.contacts).toBe(5);
    expect(estimate.laps).toEqual([
      // The default test size (200) is capped by the five contacts the segment can reach.
      { listId: listEs, routeId: route405, count: 5, costMicro: 125_000, segmentId: segment.id },
    ]);

    const created = await createLaps(t.db, orgA, campaign.id, {
      routeIds: [route405],
      sendAll: false,
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.segmentId).toBe(segment.id);
    const withLaps = await getCampaign(t.db, orgA, campaign.id);
    expect(withLaps?.laps[0]?.segmentName).toBe("Spain");

    const copy = await duplicateCampaign(t.db, orgA, campaign.id, null);
    const copied = await getCampaign(t.db, orgA, copy.id);
    expect(copied?.segments.map((s) => s.id)).toEqual([segment.id]);
  });
});
