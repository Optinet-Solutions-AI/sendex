import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  campaigns,
  clicks,
  contacts,
  laps,
  ledgerEntries,
  lists,
  messages,
  routePrices,
  routes,
} from "../schema/index.js";
import { secretKeyFromEnv } from "../secrets.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  createCustomRoute,
  customRouteCountries,
  customRouteSendingStats,
  customRouteSmsLog,
  deleteCustomRoute,
  getRouteForWorker,
  getRoutingConfig,
  listConnectionEvents,
  listCustomRoutes,
  networkStats,
  openRouteSecret,
  orderedRoutesForCountry,
  platformDeliveryReport,
  platformRouteCatalogue,
  recordConnectionEvent,
  setCustomRouteActive,
  setCustomRoutePrices,
  setRoutingStrategy,
  updateCustomRoute,
  upsertRoutingException,
} from "./routes.js";

let t: TestDb;
let org: string;
let other: string;
let platformEs: string;
let platformGb: string;
let customId: string;
const KEY = secretKeyFromEnv({ CUSTOM_ROUTE_SECRET_KEY: "c".repeat(64) });
const NOW = new Date("2026-11-07T10:00:00Z");
let seq = 0;

async function seedMessage(input: {
  o: string;
  campaignId: string;
  lapId: string;
  routeId: string;
  operator?: string | null;
  clicked?: boolean;
  bot?: boolean;
  status?: "sent" | "delivered";
  costMicro?: bigint;
}): Promise<string> {
  seq += 1;
  const [contact] = await t.db
    .insert(contacts)
    .values({
      organisationId: input.o,
      e164: `+3470${String(seq).padStart(7, "0")}`,
      country: "ES",
    })
    .returning({ id: contacts.id });
  if (!contact) throw new Error("seed");
  const [m] = await t.db
    .insert(messages)
    .values({
      organisationId: input.o,
      campaignId: input.campaignId,
      lapId: input.lapId,
      contactId: contact.id,
      e164: `+3470${String(seq).padStart(7, "0")}`,
      senderId: "SID",
      text: "hello",
      encoding: "GSM_7BIT",
      routeId: input.routeId,
      status: input.status ?? "sent",
      operator: input.operator ?? null,
      idempotencyKey: `k${seq}`,
      sentAt: NOW,
    })
    .returning({ id: messages.id });
  if (!m) throw new Error("seed");
  if (input.clicked || input.bot) {
    await t.db.insert(clicks).values({
      organisationId: input.o,
      messageId: m.id,
      campaignId: input.campaignId,
      lapId: input.lapId,
      at: NOW,
      device: input.bot ? "bot" : "mobile",
    });
  }
  await t.db.insert(ledgerEntries).values({
    organisationId: input.o,
    kind: "debit",
    amountMicro: -(input.costMicro ?? 30_000n),
    referenceType: "message",
    referenceId: m.id,
    idempotencyKey: `d${seq}`,
  });
  return m.id;
}

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  other = await seedOrganisation(t.db, "org-b");
  const [p1] = await t.db
    .insert(routes)
    .values({ provider: "platform", name: "405", country: "ES" })
    .returning({ id: routes.id });
  const [p2] = await t.db
    .insert(routes)
    .values({ provider: "platform", name: "136", country: "GB" })
    .returning({ id: routes.id });
  if (!p1 || !p2) throw new Error("seed");
  platformEs = p1.id;
  platformGb = p2.id;
  await t.db.insert(routePrices).values([
    { routeId: platformEs, country: "ES", priceMicro: 30_000n, validFrom: new Date(0) },
    { routeId: platformEs, country: "ES", priceMicro: 25_000n, validFrom: new Date("2026-01-01") },
    { routeId: platformGb, country: "GB", priceMicro: 40_000n, validFrom: new Date(0) },
    { routeId: platformGb, country: "ES", priceMicro: 35_000n, validFrom: new Date(0) },
  ]);
  const [c] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name: "ES", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [l] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: "ES list", country: "ES" })
    .returning({ id: lists.id });
  if (!c || !l) throw new Error("seed");
  const [lap405] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId: c.id,
      listId: l.id,
      routeId: platformEs,
      testSize: 5,
    })
    .returning({ id: laps.id });
  const [lap136] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId: c.id,
      listId: l.id,
      routeId: platformGb,
      testSize: 5,
    })
    .returning({ id: laps.id });
  if (!lap405 || !lap136) throw new Error("seed");
  const base = { o: org, campaignId: c.id };
  await seedMessage({
    ...base,
    lapId: lap405.id,
    routeId: platformEs,
    operator: "Orange",
    clicked: true,
  });
  await seedMessage({
    ...base,
    lapId: lap405.id,
    routeId: platformEs,
    operator: "Orange",
    status: "delivered",
  });
  await seedMessage({
    ...base,
    lapId: lap405.id,
    routeId: platformEs,
    operator: "Vodafone",
    bot: true,
  });
  await seedMessage({
    ...base,
    lapId: lap136.id,
    routeId: platformGb,
    operator: null,
    clicked: true,
    costMicro: 35_000n,
  });
});

afterAll(async () => {
  await t.close();
});

describe("platform routes", () => {
  it("lists the latest price of every platform route per country, country first", async () => {
    const rows = await platformRouteCatalogue(t.db);
    expect(rows.map((r) => [r.name, r.country, r.priceMicro])).toEqual([
      ["136", "ES", 35_000n],
      ["405", "ES", 25_000n],
      ["136", "GB", 40_000n],
    ]);
  });

  it("reports the organisation's sends per country and platform route", async () => {
    const rows = await platformDeliveryReport(t.db, org, {});
    expect(
      rows.map((r) => [r.country, r.routeName, r.sent, r.clicks, r.costMicro, r.priceMicro]),
    ).toEqual([
      ["ES", "405", 3, 1, 90_000n, 25_000n],
      ["ES", "136", 1, 1, 35_000n, 35_000n],
    ]);
    expect(await platformDeliveryReport(t.db, org, { search: "136" })).toHaveLength(1);
    expect(await platformDeliveryReport(t.db, other, {})).toEqual([]);
  });
});

describe("custom routes", () => {
  it("creates an HTTP route with its password sealed, lists it and opens the secret for the worker", async () => {
    const created = await createCustomRoute(
      t.db,
      org,
      {
        type: "http",
        name: "My Gateway",
        apiUrl: "https://gw.example.com/send?to={{{number}}}&text={{{text}}}&from={{{from}}}",
        username: "user",
        password: "pass",
        usePost: true,
        headers: [],
      },
      KEY,
    );
    customId = created.id;
    const [row] = await listCustomRoutes(t.db, org);
    expect(row).toMatchObject({
      name: "My Gateway",
      kind: "HTTP",
      host: "gw.example.com",
      active: true,
      prices: [],
    });
    expect(row?.config).not.toHaveProperty("password");
    const worker = await getRouteForWorker(t.db, customId);
    expect(worker?.secret).not.toContain("pass");
    expect(openRouteSecret(worker as NonNullable<typeof worker>, KEY)).toEqual({
      password: "pass",
    });
    expect(await listCustomRoutes(t.db, other)).toEqual([]);
  });

  it("keeps the sealed password on an update with a blank one, and switches to SMPP", async () => {
    expect(
      await updateCustomRoute(
        t.db,
        org,
        customId,
        {
          type: "smpp",
          name: "My SMPP",
          host: "smpp.example.com",
          port: 2875,
          systemId: "sys",
          password: "",
          systemType: "",
          tls: false,
        },
        KEY,
      ),
    ).toBe(true);
    const worker = await getRouteForWorker(t.db, customId);
    expect(worker?.provider).toBe("custom-smpp");
    expect(openRouteSecret(worker as NonNullable<typeof worker>, KEY)).toEqual({
      password: "pass",
    });
    const [row] = await listCustomRoutes(t.db, org);
    expect(row?.host).toBe("smpp.example.com:2875");
    expect(
      await updateCustomRoute(
        t.db,
        other,
        customId,
        {
          type: "smpp",
          name: "x",
          host: "h",
          port: 1,
          systemId: "s",
          password: "p",
          systemType: "",
          tls: false,
        },
        KEY,
      ),
    ).toBe(false);
  });

  it("sets prices (only changed ones get a new row), toggles active and records connection events", async () => {
    await setCustomRoutePrices(t.db, org, customId, [
      { country: "ES", priceMicro: 38_000n },
      { country: "FR", priceMicro: 50_000n },
    ]);
    await setCustomRoutePrices(t.db, org, customId, [
      { country: "ES", priceMicro: 38_000n },
      { country: "FR", priceMicro: 52_000n },
    ]);
    const [row] = await listCustomRoutes(t.db, org);
    expect(row?.prices).toEqual([
      { country: "ES", priceMicro: 38_000n },
      { country: "FR", priceMicro: 52_000n },
    ]);
    const priceRows = await t.db.select().from(routePrices).where(sqlRoute(customId));
    expect(priceRows).toHaveLength(3);
    expect(await customRouteCountries(t.db, org)).toEqual(["ES", "FR"]);

    expect(await setCustomRouteActive(t.db, org, customId, false)).toBe(true);
    expect((await listCustomRoutes(t.db, org))[0]?.active).toBe(false);
    await setCustomRouteActive(t.db, org, customId, true);

    await recordConnectionEvent(t.db, org, {
      routeId: customId,
      event: "bind",
      source: "test_connection",
      host: "smpp.example.com:2875",
      latencyMs: 120,
    });
    await recordConnectionEvent(t.db, org, {
      routeId: customId,
      event: "bind_failed",
      source: "test_connection",
      host: "smpp.example.com:2875",
      error: "ESME_RBINDFAIL",
    });
    const events = await listConnectionEvents(t.db, org, customId);
    expect(events.map((e) => e.event).sort()).toEqual(["bind", "bind_failed"]);
    expect((await listCustomRoutes(t.db, org))[0]?.lastEventAt).toBeInstanceOf(Date);
  });

  it("orders routes for a country by the routing configuration", async () => {
    const config = await getRoutingConfig(t.db, org);
    expect(config).toEqual({ strategy: "custom_first", feeMicro: 10_000n, exceptions: [] });
    const defaultOrder = await orderedRoutesForCountry(t.db, org, "ES");
    expect(defaultOrder.map((r) => r.name)).toEqual(["My SMPP", "405", "136"]);

    await setRoutingStrategy(t.db, org, "platform_first");
    expect((await orderedRoutesForCountry(t.db, org, "ES")).map((r) => r.name)).toEqual([
      "405",
      "136",
      "My SMPP",
    ]);

    await upsertRoutingException(t.db, org, {
      country: "ES",
      routeOrder: [],
      disabledRoutes: [platformEs],
      lockedRoute: null,
    });
    expect((await orderedRoutesForCountry(t.db, org, "ES")).map((r) => r.name)).toEqual([
      "136",
      "My SMPP",
    ]);
    await upsertRoutingException(t.db, org, {
      country: "ES",
      routeOrder: [],
      disabledRoutes: [],
      lockedRoute: customId,
    });
    expect((await orderedRoutesForCountry(t.db, org, "ES")).map((r) => r.name)).toEqual([
      "My SMPP",
    ]);
    expect((await getRoutingConfig(t.db, org)).exceptions).toHaveLength(1);
  });

  it("deletes the route and everything hanging off it", async () => {
    expect(await deleteCustomRoute(t.db, other, customId)).toBe(false);
    expect(await deleteCustomRoute(t.db, org, customId)).toBe(true);
    expect(await listCustomRoutes(t.db, org)).toEqual([]);
    expect(await getRouteForWorker(t.db, customId)).toBeNull();
  });
});

describe("stats and networks", () => {
  it("has no custom-route stats when nothing was sent on one", async () => {
    expect(await customRouteSendingStats(t.db, org, {})).toEqual([]);
    expect(await customRouteSmsLog(t.db, org, {})).toEqual([]);
  });

  it("groups operator stats per country, operator and route, naming unresolved ones", async () => {
    const stats = await networkStats(t.db, org, {});
    expect(stats).toEqual([
      {
        country: "ES",
        operator: "Orange",
        routeId: platformEs,
        routeName: "405",
        sent: 2,
        previews: 0,
        clicks: 1,
        leads: 0,
        sales: 0,
      },
      {
        country: "ES",
        operator: "Unresolved",
        routeId: platformGb,
        routeName: "136",
        sent: 1,
        previews: 0,
        clicks: 1,
        leads: 0,
        sales: 0,
      },
      {
        country: "ES",
        operator: "Vodafone",
        routeId: platformEs,
        routeName: "405",
        sent: 1,
        previews: 1,
        clicks: 0,
        leads: 0,
        sales: 0,
      },
    ]);
    expect(await networkStats(t.db, org, { routeIds: [platformGb] })).toHaveLength(1);
    expect(await networkStats(t.db, org, { search: "voda" })).toHaveLength(1);
    expect(await networkStats(t.db, other, {})).toEqual([]);
  });
});

import { eq } from "drizzle-orm";

function sqlRoute(id: string) {
  return eq(routePrices.routeId, id);
}
