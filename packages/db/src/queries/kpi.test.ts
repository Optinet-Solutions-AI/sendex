import { and, count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaignLinks,
  campaignLists,
  campaignRoutes,
  campaigns,
  laps,
  links,
  lists,
  messages,
  routes,
} from "../schema/index.js";
import { seedDemoActivity } from "../seed/demo-activity.js";
import { seedDemo } from "../seed/demo-data.js";
import { createTestDb, type TestDb } from "../test/db.js";
import { dashboardKpis } from "./dashboard.js";
import {
  createPlannedCampaign,
  kpiByOfferCountry,
  kpiDaily,
  kpiFilterOptions,
  listFollowUp,
  listOfferPairs,
  salesResults,
} from "./kpi.js";

/**
 * The KPI read models run against the demo seed plus the demo activity (D5-02): eighteen
 * finished campaigns over the six weeks before NOW, with known lists, offers and routes.
 */
const NOW = new Date("2026-11-16T12:00:00Z");
const DAY_MS = 86_400_000;

let t: TestDb;
let org: string;
let otherOrg: string;

beforeAll(async () => {
  t = await createTestDb();
  const summary = await seedDemo(t.db);
  org = summary.organisations.external ?? "";
  otherOrg = summary.organisations.internal ?? "";
  await seedDemoActivity(t.db, NOW);
}, 180_000);

afterAll(async () => {
  await t.close();
});

async function listId(name: string): Promise<string> {
  const [row] = await t.db.select({ id: lists.id }).from(lists).where(eq(lists.name, name));
  if (!row) throw new Error(`no list ${name}`);
  return row.id;
}

async function offerId(name: string): Promise<string> {
  const [row] = await t.db.select({ id: links.id }).from(links).where(eq(links.name, name));
  if (!row) throw new Error(`no offer ${name}`);
  return row.id;
}

async function routeId(name: string): Promise<string> {
  const [row] = await t.db.select({ id: routes.id }).from(routes).where(eq(routes.name, name));
  if (!row) throw new Error(`no route ${name}`);
  return row.id;
}

/** Messages of a list that reached a carrier, counted straight from the rows. */
async function submitted(name: string): Promise<number> {
  const id = await listId(name);
  const lapIds = (await t.db.select({ id: laps.id }).from(laps).where(eq(laps.listId, id))).map(
    (l) => l.id,
  );
  if (lapIds.length === 0) return 0;
  const [row] = await t.db
    .select({ n: count() })
    .from(messages)
    .where(
      and(
        inArray(messages.lapId, lapIds),
        inArray(messages.status, ["sent", "delivered", "expired"]),
      ),
    );
  return row?.n ?? 0;
}

describe("listFollowUp", () => {
  it("returns every list with what it sent, cost and earned", async () => {
    const rows = await listFollowUp(t.db, org, {});
    // Six lists of the demo seed and twelve of the demo activity.
    expect(rows).toHaveLength(18);

    const kpis = await dashboardKpis(t.db, org, {});
    expect(rows.reduce((n, r) => n + r.sent, 0)).toBe(kpis.sent);
    expect(rows.reduce((n, r) => n + r.leads, 0)).toBe(kpis.leads);
    expect(rows.reduce((n, r) => n + r.sales, 0)).toBe(kpis.sales);
    expect(rows.reduce((n, r) => n + r.costMicro, 0n)).toBe(kpis.spendMicro);

    const zen1 = rows.find((r) => r.name === "UK_ZEN_1");
    expect(zen1?.provider).toBe("ZEN");
    expect(zen1?.country).toBe("GB");
    expect(zen1?.sent).toBe(await submitted("UK_ZEN_1"));
    expect(zen1?.sales).toBeGreaterThan(0);
    expect(zen1?.revenueMicro).toBeGreaterThan(0n);
    // Its last send was five days before NOW.
    expect(zen1?.lastSentAt?.toISOString().slice(0, 10)).toBe("2026-11-11");
  });

  it("shows an untouched list with nothing sent and no last send", async () => {
    const rows = await listFollowUp(t.db, org, {});
    const untouched = rows.find((r) => r.name === "UK_ZEN_3");
    expect(untouched).toMatchObject({ sent: 0, leads: 0, sales: 0, costMicro: 0n });
    expect(untouched?.lastSentAt).toBeNull();
    expect(untouched?.numbersCount).toBe(320);
  });

  it("narrows by country and by list name", async () => {
    const es = await listFollowUp(t.db, org, { countries: ["es"] });
    expect(es.map((r) => r.country)).toEqual(Array(es.length).fill("ES"));
    expect(es).toHaveLength(4);

    const named = await listFollowUp(t.db, org, { search: "zen_1" });
    expect(named.map((r) => r.name).sort()).toEqual(["DE_ZEN_1", "ES_ZEN_1", "UK_ZEN_1"]);
  });

  it("counts only one offer's sends when an offer is picked", async () => {
    const trixino = await offerId("Trixino");
    const rows = await listFollowUp(t.db, org, { linkId: trixino });
    const sentTo = rows.filter((r) => r.sent > 0).map((r) => r.name);
    expect(sentTo.sort()).toEqual(["ES_DER_1", "UK_DER_1", "UK_ZEN_1", "UK_ZEN_2"]);
    // A list that only went to other offers reads as never sent to this one.
    expect(rows.find((r) => r.name === "UK_DIM_1")?.sent).toBe(0);
  });

  it("counts only one route's sends when a route is picked", async () => {
    const rows = await listFollowUp(t.db, org, { routeId: await routeId("391") });
    expect(
      rows
        .filter((r) => r.sent > 0)
        .map((r) => r.name)
        .sort(),
    ).toEqual(["PL_DER_1", "PL_DIM_1"]);
  });

  it("windows sends on the send day and sales on the deposit day", async () => {
    const window = { from: new Date(NOW.getTime() - 7 * DAY_MS), to: NOW };
    const rows = await listFollowUp(t.db, org, window);
    const kpis = await dashboardKpis(t.db, org, window);
    expect(rows.reduce((n, r) => n + r.sent, 0)).toBe(kpis.sent);
    expect(rows.reduce((n, r) => n + r.sales, 0)).toBe(kpis.sales);
    // PL_DER_1 was last sent 21 days before NOW: nothing sent in the last week.
    expect(rows.find((r) => r.name === "PL_DER_1")?.sent).toBe(0);
  });

  it("is scoped to the organisation", async () => {
    expect(await listFollowUp(t.db, otherOrg, {})).toEqual([]);
  });
});

describe("kpiFilterOptions", () => {
  it("lists the routes that sent, the offers and the list countries", async () => {
    const options = await kpiFilterOptions(t.db, org);
    expect(options.routes.map((r) => r.name)).toEqual(["136", "137", "391", "400", "724"]);
    expect(options.offers.map((o) => o.name)).toEqual([
      "Gambiva Roy Boy",
      "Lucky Reel",
      "Rolling Slots",
      "Trixino",
    ]);
    expect(options.countries).toEqual(["DE", "ES", "FI", "FR", "GB", "PL"]);
    expect(options.providers).toEqual(["DER", "DIM", "RIS", "ZEN"]);
  });

  it("is scoped to the organisation", async () => {
    const options = await kpiFilterOptions(t.db, otherOrg);
    expect(options).toEqual({ routes: [], offers: [], countries: [], providers: [] });
  });
});

describe("kpiByOfferCountry", () => {
  it("returns one row per offer and country that adds up to the dashboard", async () => {
    const rows = await kpiByOfferCountry(t.db, org, {});
    const kpis = await dashboardKpis(t.db, org, {});
    expect(rows.reduce((n, r) => n + r.sent, 0)).toBe(kpis.sent);
    expect(rows.reduce((n, r) => n + r.sales, 0)).toBe(kpis.sales);
    expect(rows.reduce((n, r) => n + r.costMicro, 0n)).toBe(kpis.spendMicro);
    expect(new Set(rows.map((r) => `${r.country}:${r.offer}`)).size).toBe(rows.length);

    // Trixino went to three UK lists and one Spanish list.
    const trixino = rows.filter((r) => r.offer === "Trixino");
    expect(trixino.map((r) => r.country).sort()).toEqual(["ES", "GB"]);
    const followUp = await listFollowUp(t.db, org, { linkId: await offerId("Trixino") });
    expect(trixino.reduce((n, r) => n + r.sent, 0)).toBe(followUp.reduce((n, r) => n + r.sent, 0));
    expect(trixino.every((r) => r.offerId === trixino[0]?.offerId)).toBe(true);
  });

  it("follows the window and the organisation", async () => {
    const window = { from: new Date(NOW.getTime() - 10 * DAY_MS), to: NOW };
    const rows = await kpiByOfferCountry(t.db, org, window);
    const kpis = await dashboardKpis(t.db, org, window);
    expect(rows.reduce((n, r) => n + r.sent, 0)).toBe(kpis.sent);
    expect(rows.reduce((n, r) => n + r.sales, 0)).toBe(kpis.sales);
    expect(await kpiByOfferCountry(t.db, otherOrg, {})).toEqual([]);
  });
});

describe("salesResults", () => {
  it("returns the days with a lead or a sale, per offer, route, country, list and provider", async () => {
    const rows = await salesResults(t.db, org, {});
    const kpis = await dashboardKpis(t.db, org, {});
    expect(rows.reduce((n, r) => n + r.leads, 0)).toBe(kpis.leads);
    expect(rows.reduce((n, r) => n + r.sales, 0)).toBe(kpis.sales);
    expect(rows.every((r) => r.leads > 0 || r.sales > 0)).toBe(true);
    // Most sales first.
    expect(rows.map((r) => r.sales)).toEqual([...rows.map((r) => r.sales)].sort((a, b) => b - a));

    const row = rows.find((r) => r.listName === "UK_ZEN_1" && r.offer === "Trixino");
    expect(row).toMatchObject({ country: "GB", provider: "ZEN", routeName: "137" });
    expect(row?.day).toMatch(/^2026-\d{2}-\d{2}$/);
    expect(rows.filter((r) => r.sales > 0).every((r) => r.revenueMicro > 0n)).toBe(true);
  });

  it("follows the window and the organisation", async () => {
    const window = { from: new Date(NOW.getTime() - 10 * DAY_MS), to: NOW };
    const rows = await salesResults(t.db, org, window);
    const kpis = await dashboardKpis(t.db, org, window);
    expect(rows.reduce((n, r) => n + r.leads, 0)).toBe(kpis.leads);
    expect(rows.reduce((n, r) => n + r.sales, 0)).toBe(kpis.sales);
    expect(rows.every((r) => r.day >= "2026-11-06" && r.day <= "2026-11-16")).toBe(true);
    expect(await salesResults(t.db, otherOrg, {})).toEqual([]);
  });
});

describe("kpiDaily", () => {
  it("gives leads and sales per day and group, for each way of grouping", async () => {
    const kpis = await dashboardKpis(t.db, org, {});
    for (const by of ["route", "offer", "country", "provider"] as const) {
      const rows = await kpiDaily(t.db, org, {}, by);
      expect(rows.reduce((n, r) => n + r.leads, 0)).toBe(kpis.leads);
      expect(rows.reduce((n, r) => n + r.sales, 0)).toBe(kpis.sales);
      expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day))).toBe(true);
      expect(new Set(rows.map((r) => `${r.day}:${r.key}`)).size).toBe(rows.length);
    }
    const keys = async (by: "route" | "offer" | "country" | "provider") =>
      [...new Set((await kpiDaily(t.db, org, {}, by)).map((r) => r.key))].sort();
    expect(await keys("route")).toEqual(["136", "137", "391", "400", "724"]);
    expect(await keys("country")).toEqual(["ES", "GB", "PL"]);
    expect(await keys("provider")).toEqual(["DER", "DIM", "ZEN"]);
    expect(await keys("offer")).toEqual([
      "Gambiva Roy Boy",
      "Lucky Reel",
      "Rolling Slots",
      "Trixino",
    ]);
  });

  it("follows the window and the organisation", async () => {
    const window = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") };
    const rows = await kpiDaily(t.db, org, window, "route");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.day.startsWith("2026-11-"))).toBe(true);
    expect(await kpiDaily(t.db, otherOrg, {}, "route")).toEqual([]);
  });
});

describe("listOfferPairs", () => {
  it("says what each list did with each offer", async () => {
    const pairs = await listOfferPairs(t.db, org, {});
    const zen1 = await listId("UK_ZEN_1");
    const trixino = await offerId("Trixino");
    const pair = pairs.find((p) => p.listId === zen1 && p.offerId === trixino);
    expect(pair?.sent).toBeGreaterThan(0);
    // UK_ZEN_1 got Trixino 24 days before NOW.
    expect(pair?.lastSentAt?.toISOString().slice(0, 10)).toBe("2026-10-23");
    // An untouched list has no pair at all.
    const zen3 = await listId("UK_ZEN_3");
    expect(pairs.some((p) => p.listId === zen3)).toBe(false);
    expect(new Set(pairs.map((p) => `${p.listId}:${p.offerId}`)).size).toBe(pairs.length);
  });

  it("follows the window and the organisation", async () => {
    const window = { from: new Date(NOW.getTime() - 7 * DAY_MS), to: NOW };
    const pairs = await listOfferPairs(t.db, org, window);
    const zen1 = await listId("UK_ZEN_1");
    const trixino = await offerId("Trixino");
    expect(pairs.some((p) => p.listId === zen1 && p.offerId === trixino)).toBe(false);
    expect(await listOfferPairs(t.db, otherOrg, {})).toEqual([]);
  });
});

describe("createPlannedCampaign", () => {
  it("creates a draft with the list, the offer, the route and the planned day", async () => {
    const input = {
      offerId: await offerId("Trixino"),
      listId: await listId("UK_ZEN_3"),
      routeId: await routeId("724"),
      plannedFor: "2026-11-17",
    };
    const campaign = await createPlannedCampaign(t.db, org, input);
    expect(campaign).toMatchObject({
      name: "Trixino → UK_ZEN_3",
      country: "GB",
      timezone: "Europe/London",
      status: "draft",
      plannedFor: "2026-11-17",
      scheduledAt: null,
    });
    const attachedLists = await t.db
      .select({ id: campaignLists.listId })
      .from(campaignLists)
      .where(eq(campaignLists.campaignId, campaign.id));
    expect(attachedLists.map((l) => l.id)).toEqual([input.listId]);
    const attachedLinks = await t.db
      .select({ id: campaignLinks.linkId })
      .from(campaignLinks)
      .where(eq(campaignLinks.campaignId, campaign.id));
    expect(attachedLinks.map((l) => l.id)).toEqual([input.offerId]);
    const picked = await t.db
      .select({ id: campaignRoutes.routeId })
      .from(campaignRoutes)
      .where(eq(campaignRoutes.campaignId, campaign.id));
    expect(picked.map((r) => r.id)).toEqual([input.routeId]);
  });

  it("refuses a route that cannot carry the list's country, and other people's rows", async () => {
    const offer = await offerId("Trixino");
    const list = await listId("UK_ZEN_3");
    const before = await t.db.select({ n: count() }).from(campaigns);
    await expect(
      createPlannedCampaign(t.db, org, {
        offerId: offer,
        listId: list,
        routeId: await routeId("391"),
        plannedFor: "2026-11-17",
      }),
    ).rejects.toThrow("This route cannot carry a campaign for United Kingdom");
    await expect(
      createPlannedCampaign(t.db, otherOrg, {
        offerId: offer,
        listId: list,
        routeId: await routeId("724"),
        plannedFor: "2026-11-17",
      }),
    ).rejects.toThrow("List not found");
    await expect(
      createPlannedCampaign(t.db, org, {
        offerId: list,
        listId: list,
        routeId: await routeId("724"),
        plannedFor: "2026-11-17",
      }),
    ).rejects.toThrow("Offer not found");
    // Nothing half-made is left behind.
    expect(await t.db.select({ n: count() }).from(campaigns)).toEqual(before);
  });
});
