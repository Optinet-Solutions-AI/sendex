import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  campaignLinks,
  campaignLists,
  campaignRoutes,
  campaigns,
  clicks,
  contacts,
  laps,
  ledgerEntries,
  links,
  listMembers,
  lists,
  messages,
  organisations,
  postbacks,
  routes,
} from "../schema/index.js";
import type { Db } from "../types.js";
import { eurToMicro, seedUuid } from "./demo-data.js";

/**
 * Past activity for the demo organisation (External), for trying the KPI screens on a local
 * database (D5-02): lists with data providers (some left untouched), finished campaigns, their
 * messages with ledger debits, clicks, registrations and first deposits spread over the last
 * six weeks. Run it after the demo seed with `pnpm db:seed:activity`.
 *
 * Everything is keyed by deterministic ids and inserted with `onConflictDoNothing`, so a second
 * run changes nothing. The numbers are made up and nothing here is ever sent.
 */

const CHUNK = 500;
const DAY_MS = 86_400_000;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** A stable number in [0, 1) from a key, so the same message always gets the same outcome. */
function chance(key: string): number {
  const hex = createHash("sha1").update(`sendex-activity:${key}`).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) / 0x1_0000_0000;
}

/** True for a Postgres URL on this machine; the activity seed refuses anything else. */
export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

interface ActivityList {
  name: string;
  country: string;
  provider: string;
  /** E.164 prefix of the made-up numbers; 4 digits follow. */
  prefix: string;
  /** False leaves the list untouched, for "never sent" in List Follow-Up. */
  used: boolean;
}

const LIST_SIZE = 320;

export const ACTIVITY_LISTS: readonly ActivityList[] = [
  { name: "UK_ZEN_1", country: "GB", provider: "ZEN", prefix: "+44791110", used: true },
  { name: "UK_ZEN_2", country: "GB", provider: "ZEN", prefix: "+44791111", used: true },
  { name: "UK_DER_1", country: "GB", provider: "DER", prefix: "+44791112", used: true },
  { name: "UK_DIM_1", country: "GB", provider: "DIM", prefix: "+44791113", used: true },
  { name: "UK_ZEN_3", country: "GB", provider: "ZEN", prefix: "+44791114", used: false },
  { name: "UK_RIS_1", country: "GB", provider: "RIS", prefix: "+44791115", used: false },
  { name: "ES_DER_1", country: "ES", provider: "DER", prefix: "+3469110", used: true },
  { name: "ES_ZEN_1", country: "ES", provider: "ZEN", prefix: "+3469111", used: true },
  { name: "ES_DIM_1", country: "ES", provider: "DIM", prefix: "+3469112", used: false },
  { name: "PL_DIM_1", country: "PL", provider: "DIM", prefix: "+4850911", used: true },
  { name: "PL_DER_1", country: "PL", provider: "DER", prefix: "+4850912", used: true },
  { name: "DE_ZEN_1", country: "DE", provider: "ZEN", prefix: "+49151911", used: false },
];

interface ActivityOffer {
  name: string;
  url: string;
  /**
   * What one first deposit pays, in EUR. Kept small on purpose: the demo sends are a few
   * hundred SMS each, so a real payout would make every ROI read in the thousands of percent.
   */
  payoutEur: number;
}

const OFFERS: readonly ActivityOffer[] = [
  {
    name: "Rolling Slots",
    url: "https://trk.example.com/click?o=75&a=35&sub_id1={{dynamic}}",
    payoutEur: 24,
  },
  {
    name: "Gambiva Roy Boy",
    url: "https://trk.example.com/click?o=76&a=35&sub_id1={{dynamic}}",
    payoutEur: 18,
  },
  {
    name: "Trixino",
    url: "https://trk.example.com/click?o=77&a=35&sub_id1={{dynamic}}",
    payoutEur: 30,
  },
  {
    name: "Lucky Reel",
    url: "https://trk.example.com/click?o=81&a=35&sub_id1={{dynamic}}",
    payoutEur: 22,
  },
];

const TIMEZONES: Record<string, string> = {
  GB: "Europe/London",
  ES: "Europe/Madrid",
  PL: "Europe/Warsaw",
  DE: "Europe/Berlin",
};

/** The platform route each country's demo sends go through, with the seeded price in EUR. */
const ROUTE_FOR: Record<string, readonly { name: string; eur: number }[]> = {
  GB: [
    { name: "724", eur: 0.0398 },
    { name: "137", eur: 0.0371 },
  ],
  // Not 405 or 403: the browser tests measure those two routes.
  ES: [
    { name: "400", eur: 0.027 },
    { name: "136", eur: 0.028 },
  ],
  PL: [{ name: "391", eur: 0.022 }],
};

interface ActivitySend {
  list: string;
  offer: string;
  /** Index into the country's routes. */
  route: number;
  daysAgo: number;
  size: number;
  leadRate: number;
  saleRate: number;
}

/** One finished campaign each: a list, an offer, a route and the day it went out. */
const SENDS: readonly ActivitySend[] = [
  {
    list: "UK_ZEN_1",
    offer: "Rolling Slots",
    route: 0,
    daysAgo: 44,
    size: 260,
    leadRate: 0.05,
    saleRate: 0.012,
  },
  {
    list: "UK_DER_1",
    offer: "Rolling Slots",
    route: 1,
    daysAgo: 41,
    size: 240,
    leadRate: 0.04,
    saleRate: 0.008,
  },
  {
    list: "ES_DER_1",
    offer: "Gambiva Roy Boy",
    route: 0,
    daysAgo: 38,
    size: 220,
    leadRate: 0.03,
    saleRate: 0.005,
  },
  {
    list: "UK_ZEN_2",
    offer: "Trixino",
    route: 0,
    daysAgo: 35,
    size: 250,
    leadRate: 0.06,
    saleRate: 0.016,
  },
  {
    list: "PL_DIM_1",
    offer: "Lucky Reel",
    route: 0,
    daysAgo: 33,
    size: 230,
    leadRate: 0.03,
    saleRate: 0.009,
  },
  {
    list: "UK_DIM_1",
    offer: "Gambiva Roy Boy",
    route: 1,
    daysAgo: 30,
    size: 240,
    leadRate: 0.02,
    saleRate: 0.004,
  },
  {
    list: "ES_ZEN_1",
    offer: "Rolling Slots",
    route: 1,
    daysAgo: 27,
    size: 210,
    leadRate: 0.04,
    saleRate: 0.01,
  },
  {
    list: "UK_ZEN_1",
    offer: "Trixino",
    route: 1,
    daysAgo: 24,
    size: 260,
    leadRate: 0.05,
    saleRate: 0.012,
  },
  {
    list: "PL_DER_1",
    offer: "Lucky Reel",
    route: 0,
    daysAgo: 21,
    size: 220,
    leadRate: 0.04,
    saleRate: 0.014,
  },
  {
    list: "UK_DER_1",
    offer: "Lucky Reel",
    route: 0,
    daysAgo: 18,
    size: 250,
    leadRate: 0.03,
    saleRate: 0.004,
  },
  {
    list: "UK_ZEN_2",
    offer: "Rolling Slots",
    route: 1,
    daysAgo: 14,
    size: 260,
    leadRate: 0.07,
    saleRate: 0.02,
  },
  {
    list: "ES_DER_1",
    offer: "Trixino",
    route: 1,
    daysAgo: 11,
    size: 220,
    leadRate: 0.03,
    saleRate: 0.009,
  },
  {
    list: "UK_DIM_1",
    offer: "Rolling Slots",
    route: 0,
    daysAgo: 9,
    size: 240,
    leadRate: 0.04,
    saleRate: 0.008,
  },
  {
    list: "PL_DIM_1",
    offer: "Rolling Slots",
    route: 0,
    daysAgo: 7,
    size: 230,
    leadRate: 0.02,
    saleRate: 0.004,
  },
  {
    list: "UK_ZEN_1",
    offer: "Rolling Slots",
    route: 0,
    daysAgo: 5,
    size: 260,
    leadRate: 0.06,
    saleRate: 0.015,
  },
  {
    list: "UK_DER_1",
    offer: "Trixino",
    route: 1,
    daysAgo: 3,
    size: 250,
    leadRate: 0.05,
    saleRate: 0.012,
  },
  {
    list: "ES_ZEN_1",
    offer: "Gambiva Roy Boy",
    route: 0,
    daysAgo: 2,
    size: 210,
    leadRate: 0.03,
    saleRate: 0.005,
  },
  {
    list: "UK_ZEN_2",
    offer: "Lucky Reel",
    route: 0,
    daysAgo: 1,
    size: 260,
    leadRate: 0.05,
    saleRate: 0.012,
  },
];

const ACTIVITY_DEPOSIT_MICRO = eurToMicro(2_000);

export interface ActivitySummary {
  lists: number;
  campaigns: number;
  messages: number;
  clicks: number;
  leads: number;
  sales: number;
}

export async function seedDemoActivity(db: Db, now: Date = new Date()): Promise<ActivitySummary> {
  const [org] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, "external"));
  if (!org) throw new Error("Run the demo seed first: the External organisation is missing");
  const organisationId = org.id;
  // The screens this data is for are behind the preview switch (D5-09).
  await db
    .update(organisations)
    .set({ previewFeatures: true })
    .where(eq(organisations.id, organisationId));

  // A re-run keeps the dates of the first run: a campaign that exists is not touched again.
  const existing = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      inArray(
        campaigns.id,
        SENDS.map((s) => campaignIdOf(organisationId, s)),
      ),
    );
  const done = new Set(existing.map((c) => c.id));

  await seedOffers(db, organisationId);
  await seedLists(db, organisationId);
  const routeIds = await platformRouteIds(db);
  await db
    .insert(ledgerEntries)
    .values({
      id: seedUuid(`activity:${organisationId}:deposit`),
      organisationId,
      kind: "deposit",
      amountMicro: ACTIVITY_DEPOSIT_MICRO,
      referenceType: "manual",
      idempotencyKey: `seed-activity:${organisationId}:deposit`,
      note: "Demo activity balance",
    })
    .onConflictDoNothing();

  const summary: ActivitySummary = {
    lists: ACTIVITY_LISTS.length,
    campaigns: SENDS.length,
    messages: 0,
    clicks: 0,
    leads: 0,
    sales: 0,
  };
  for (const send of SENDS) {
    const totals = sendTotals(organisationId, send, now);
    summary.messages += totals.messages;
    summary.clicks += totals.clicks;
    summary.leads += totals.leads;
    summary.sales += totals.sales;
    if (!done.has(campaignIdOf(organisationId, send))) {
      await seedSend(db, organisationId, send, routeIds, now);
    }
  }
  return summary;
}

function campaignIdOf(organisationId: string, send: ActivitySend): string {
  return seedUuid(`activity:${organisationId}:campaign:${send.list}:${send.offer}:${send.daysAgo}`);
}

function listIdOf(organisationId: string, name: string): string {
  return seedUuid(`list:${organisationId}:${name}`);
}

function linkIdOf(organisationId: string, name: string): string {
  return seedUuid(`link:${organisationId}:${name}`);
}

function numberOf(list: ActivityList, i: number): string {
  return `${list.prefix}${String(i).padStart(4, "0")}`;
}

async function seedOffers(db: Db, organisationId: string): Promise<void> {
  await db
    .insert(links)
    .values(
      OFFERS.map((o) => ({
        id: linkIdOf(organisationId, o.name),
        organisationId,
        name: o.name,
        url: o.url,
        profitMicro: eurToMicro(o.payoutEur),
      })),
    )
    .onConflictDoNothing();
}

async function seedLists(db: Db, organisationId: string): Promise<void> {
  for (const list of ACTIVITY_LISTS) {
    const listId = listIdOf(organisationId, list.name);
    await db
      .insert(lists)
      .values({
        id: listId,
        organisationId,
        name: list.name,
        country: list.country,
        provider: list.provider,
        numbersCount: LIST_SIZE,
      })
      .onConflictDoNothing();
    const numbers = Array.from({ length: LIST_SIZE }, (_, i) => numberOf(list, i));
    for (const chunk of chunks(numbers)) {
      await db
        .insert(contacts)
        .values(
          chunk.map((e164) => ({
            id: seedUuid(`contact:${organisationId}:${e164}`),
            organisationId,
            e164,
            country: list.country,
          })),
        )
        .onConflictDoNothing();
      await db
        .insert(listMembers)
        .values(
          chunk.map((e164) => ({
            id: seedUuid(`member:${listId}:${e164}`),
            organisationId,
            listId,
            contactId: seedUuid(`contact:${organisationId}:${e164}`),
          })),
        )
        .onConflictDoNothing();
    }
  }
}

async function platformRouteIds(db: Db): Promise<Map<string, string>> {
  const names = [...new Set(Object.values(ROUTE_FOR).flatMap((r) => r.map((x) => x.name)))];
  const rows = await db
    .select({ id: routes.id, name: routes.name })
    .from(routes)
    .where(and(isNull(routes.organisationId), inArray(routes.name, names)));
  const map = new Map(rows.map((r) => [r.name, r.id]));
  for (const name of names) {
    if (!map.has(name))
      throw new Error(`Run the demo seed first: platform route ${name} is missing`);
  }
  return map;
}

interface PlannedMessage {
  index: number;
  e164: string;
  status: "delivered" | "sent" | "failed";
  sentAt: Date;
  clickAt: Date | null;
  leadAt: Date | null;
  saleAt: Date | null;
}

/** What each message of a send does. Pure, so the summary and the rows agree. */
function planSend(organisationId: string, send: ActivitySend, now: Date): PlannedMessage[] {
  const list = ACTIVITY_LISTS.find((l) => l.name === send.list);
  if (!list) throw new Error(`Unknown demo list ${send.list}`);
  const key = campaignIdOf(organisationId, send);
  const day = new Date(now.getTime() - send.daysAgo * DAY_MS);
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 9, 30);
  const before = (at: number): Date | null => (at <= now.getTime() ? new Date(at) : null);
  return Array.from({ length: send.size }, (_, index) => {
    const sentAt = new Date(start + index * 20_000);
    const roll = chance(`${key}:${index}:status`);
    const status = roll < 0.05 ? "failed" : roll < 0.08 ? "sent" : "delivered";
    const reached = status === "delivered";
    const lead = reached && chance(`${key}:${index}:lead`) < send.leadRate;
    const sale = reached && chance(`${key}:${index}:sale`) < send.saleRate;
    const click = reached && (lead || sale || chance(`${key}:${index}:click`) < 0.08);
    const delayDays = Math.floor(chance(`${key}:${index}:delay`) * 6);
    return {
      index,
      e164: numberOf(list, index),
      status,
      sentAt,
      clickAt: click ? before(sentAt.getTime() + 15 * 60_000) : null,
      leadAt: lead || sale ? before(sentAt.getTime() + 40 * 60_000) : null,
      saleAt: sale ? before(sentAt.getTime() + delayDays * DAY_MS + 3 * 3_600_000) : null,
    };
  });
}

function sendTotals(organisationId: string, send: ActivitySend, now: Date) {
  const plan = planSend(organisationId, send, now);
  return {
    messages: plan.length,
    clicks: plan.filter((m) => m.clickAt).length,
    leads: plan.filter((m) => m.leadAt).length,
    sales: plan.filter((m) => m.saleAt).length,
  };
}

async function seedSend(
  db: Db,
  organisationId: string,
  send: ActivitySend,
  routeIds: Map<string, string>,
  now: Date,
): Promise<void> {
  const list = ACTIVITY_LISTS.find((l) => l.name === send.list);
  const offer = OFFERS.find((o) => o.name === send.offer);
  const route = list ? ROUTE_FOR[list.country]?.[send.route] : undefined;
  if (!list || !offer || !route) throw new Error(`Bad demo send ${send.list} / ${send.offer}`);
  const routeId = routeIds.get(route.name);
  if (!routeId) throw new Error(`Platform route ${route.name} is missing`);

  const campaignId = campaignIdOf(organisationId, send);
  const lapId = seedUuid(`activity:lap:${campaignId}`);
  const listId = listIdOf(organisationId, list.name);
  const linkId = linkIdOf(organisationId, offer.name);
  const plan = planSend(organisationId, send, now);
  const priceMicro = eurToMicro(route.eur);
  const payoutMicro = eurToMicro(offer.payoutEur);
  const first = plan[0]?.sentAt ?? now;
  const last = plan[plan.length - 1]?.sentAt ?? now;
  const submitted = plan.filter((m) => m.status !== "failed");
  const sales = plan.filter((m) => m.saleAt);

  await db.transaction(async (tx) => {
    await tx.insert(campaigns).values({
      id: campaignId,
      organisationId,
      name: `${offer.name} → ${list.name}`,
      country: list.country,
      timezone: TIMEZONES[list.country] ?? "UTC",
      status: "completed",
      createdAt: first,
      updatedAt: last,
    });
    await tx.insert(campaignLists).values({ campaignId, listId, organisationId });
    await tx.insert(campaignLinks).values({ campaignId, linkId, organisationId });
    await tx.insert(campaignRoutes).values({ campaignId, routeId, organisationId });
    await tx.insert(laps).values({
      id: lapId,
      organisationId,
      campaignId,
      listId,
      routeId,
      testSize: send.size,
      status: "done",
      sent: submitted.length,
      delivered: plan.filter((m) => m.status === "delivered").length,
      failed: plan.length - submitted.length,
      clicks: plan.filter((m) => m.clickAt).length,
      leads: plan.filter((m) => m.leadAt).length,
      sales: sales.length,
      costMicro: priceMicro * BigInt(submitted.length),
      revenueMicro: payoutMicro * BigInt(sales.length),
      rank: 1,
      startedAt: first,
      finishedAt: last,
      createdAt: first,
    });

    const messageId = (m: PlannedMessage) => seedUuid(`activity:message:${lapId}:${m.index}`);
    const dynamicId = (m: PlannedMessage) => `demo-${lapId.slice(0, 8)}-${m.index}`;
    for (const chunk of chunks(plan)) {
      await tx.insert(messages).values(
        chunk.map((m) => ({
          id: messageId(m),
          organisationId,
          campaignId,
          lapId,
          contactId: seedUuid(`contact:${organisationId}:${m.e164}`),
          e164: m.e164,
          senderId: "VIPCLUB",
          text: `Your bonus is waiting: https://sdx.example/${dynamicId(m)}`,
          encoding: "GSM_7BIT",
          parts: 1,
          routeId,
          status: m.status,
          dynamicId: dynamicId(m),
          linkId,
          idempotencyKey: `seed-activity:${lapId}:${m.index}`,
          createdAt: m.sentAt,
          sentAt: m.status === "failed" ? null : m.sentAt,
          deliveredAt: m.status === "delivered" ? new Date(m.sentAt.getTime() + 8_000) : null,
        })),
      );
    }
    for (const chunk of chunks(submitted)) {
      await tx.insert(ledgerEntries).values(
        chunk.map((m) => ({
          organisationId,
          kind: "debit" as const,
          amountMicro: -priceMicro,
          referenceType: "message",
          referenceId: messageId(m),
          idempotencyKey: `seed-activity:debit:${lapId}:${m.index}`,
          createdAt: m.sentAt,
        })),
      );
    }
    const clicked = plan.filter((m) => m.clickAt);
    if (clicked.length > 0) {
      await tx.insert(clicks).values(
        clicked.map((m) => ({
          organisationId,
          messageId: messageId(m),
          campaignId,
          lapId,
          at: m.clickAt ?? m.sentAt,
          country: list.country,
          device: "mobile",
        })),
      );
    }
    const events = plan.flatMap((m) => [
      ...(m.leadAt
        ? [{ m, type: "lead" as const, at: m.leadAt, valueMicro: null as bigint | null }]
        : []),
      ...(m.saleAt ? [{ m, type: "sale" as const, at: m.saleAt, valueMicro: payoutMicro }] : []),
    ]);
    if (events.length > 0) {
      await tx.insert(postbacks).values(
        events.map((e) => ({
          organisationId,
          eventKey: `seed-activity:${e.type}:${lapId}:${e.m.index}`,
          type: e.type,
          dynamicId: dynamicId(e.m),
          messageId: messageId(e.m),
          campaignId,
          lapId,
          valueMicro: e.valueMicro,
          // Made-up data: each first deposit earns the offer's payout as its deal CPA (D5-16).
          revenueMicro: e.type === "sale" ? e.valueMicro : null,
          params: { source: "demo" },
          receivedAt: e.at,
        })),
      );
    }
    for (const chunk of chunks(submitted)) {
      await tx
        .update(listMembers)
        .set({ sentAt: last })
        .where(
          and(
            eq(listMembers.listId, listId),
            inArray(
              listMembers.contactId,
              chunk.map((m) => seedUuid(`contact:${organisationId}:${m.e164}`)),
            ),
          ),
        );
    }
    await tx.update(lists).set({ lastSentAt: last }).where(eq(lists.id, listId));
  });
}
