import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  contacts,
  ledgerEntries,
  links,
  listMembers,
  lists,
  organisations,
  routePrices,
  routes,
  senderIds,
  sidGroups,
} from "../schema/index.js";
import type { Db } from "../types.js";

/**
 * Demo data for the two organisations (External, Internal), modelled on the
 * SMS Edge account the brief describes. Every row has a deterministic id derived
 * from its natural key, every insert is `onConflictDoNothing`, so running the
 * seed twice (or after a partial run) changes nothing.
 */

const CHUNK = 1_000;
const SEED_DATE = new Date("2026-09-14T10:00:00Z");
const PRICE_VALID_FROM = new Date("2026-01-01T00:00:00Z");

/** Stable UUID (v5 layout) from a natural key, so re-runs produce the same ids. */
export function seedUuid(key: string): string {
  const hex = createHash("sha1").update(`sendex-seed:${key}`).digest("hex").slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13, 16)}`;
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  const tail = `${variant}${hex.slice(17, 20)}${hex.slice(20)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12)}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

interface CountryList {
  /** Tag used in the list name (UK rather than GB, as the client names them). */
  tag: string;
  country: string;
  count: number;
  /** E.164 prefix including the mobile range, e.g. +346 for Spanish 6xx numbers. */
  prefix: string;
  /** Digits after the prefix. */
  digits: number;
  /** First subscriber number; later numbers count up from it. */
  start: number;
  senderIds: readonly string[];
}

const COUNTRY_LISTS: readonly CountryList[] = [
  {
    tag: "ES",
    country: "ES",
    count: 1_738,
    prefix: "+346",
    digits: 8,
    start: 12_345_678,
    senderIds: [
      "BIGSPINS",
      "BONOES",
      "BONUS777",
      "BONUSVIP",
      "GIROSVIP",
      "JuegoBox",
      "Lucky1",
      "LUCKY777",
      "MEGASPIN",
      "SPINWIN",
      "VIPCLUB",
      "JACKPOTES",
      "FREESPIN",
      "GOLDSPIN",
      "LUCKYBOX",
      "WINNOW",
      "CASINOVIP",
    ],
  },
  {
    tag: "FR",
    country: "FR",
    count: 1_947,
    prefix: "+336",
    digits: 8,
    start: 12_345_678,
    senderIds: [
      "BONUS777",
      "BONUSVIP",
      "Lucky1",
      "LUCKY777",
      "MEGASPIN",
      "SPINWIN",
      "VIPCLUB",
      "JACKPOT",
      "FREESPIN",
      "GOLDSPIN",
      "BONUSFR",
      "TOURSVIP",
    ],
  },
  {
    tag: "UK",
    country: "GB",
    count: 2_997,
    prefix: "+447",
    digits: 9,
    start: 700_123_456,
    senderIds: [
      "RewardUK",
      "BIGSPINS",
      "BONUS777",
      "BONUSVIP",
      "Lucky1",
      "LUCKY777",
      "MEGASPIN",
      "SPINWIN",
      "VIPCLUB",
      "FREESPIN",
    ],
  },
  {
    tag: "DE",
    country: "DE",
    count: 3_000,
    prefix: "+4915",
    digits: 8,
    start: 11_234_567,
    senderIds: [
      "BONUS777",
      "BONUSVIP",
      "Lucky1",
      "LUCKY777",
      "MEGASPIN",
      "SPINWIN",
      "VIPCLUB",
      "FREISPIEL",
      "BONUSDE",
    ],
  },
  {
    tag: "PL",
    country: "PL",
    count: 3_000,
    prefix: "+485",
    digits: 8,
    start: 1_234_567,
    senderIds: [
      "BONUS777",
      "BONUSVIP",
      "Lucky1",
      "LUCKY777",
      "MEGASPIN",
      "SPINWIN",
      "VIPCLUB",
      "BONUSPL",
    ],
  },
  {
    tag: "FI",
    country: "FI",
    count: 2_600,
    prefix: "+3584",
    digits: 8,
    start: 1_234_567,
    senderIds: [
      "BONUS777",
      "BONUSVIP",
      "Lucky1",
      "LUCKY777",
      "MEGASPIN",
      "SPINWIN",
      "VIPCLUB",
      "FREESPIN",
      "GOLDSPIN",
      "BONUSFI",
      "PYORAYTA",
    ],
  },
];

const LINKS = [
  { name: "Rolling Slots", url: "https://trk.example.com/click?o=75&a=35&sub_id1={{dynamic}}" },
  { name: "Gambiva Roy Boy", url: "https://trk.example.com/click?o=76&a=35&sub_id1={{dynamic}}" },
  { name: "Trixino", url: "https://trk.example.com/click?o=77&a=35&sub_id1={{dynamic}}" },
] as const;

/** Platform routes with their per-country prices in EUR. */
const PLATFORM_ROUTES: ReadonlyArray<{ name: string; prices: ReadonlyArray<[string, number]> }> = [
  { name: "375", prices: [["FR", 0.0357]] },
  { name: "724", prices: [["GB", 0.0398]] },
  {
    name: "137",
    prices: [
      ["GB", 0.0371],
      ["DE", 0.0686],
    ],
  },
  {
    name: "250",
    prices: [
      ["NZ", 0.0604],
      ["GB", 0.0391],
    ],
  },
  {
    name: "423",
    prices: [
      ["FR", 0.0384],
      ["DE", 0.0412],
    ],
  },
  { name: "391", prices: [["PL", 0.022]] },
  { name: "405", prices: [["ES", 0.025]] },
  { name: "403", prices: [["ES", 0.027]] },
  { name: "400", prices: [["ES", 0.027]] },
  { name: "136", prices: [["ES", 0.028]] },
];

const EXTERNAL_DEPOSIT_MICRO = 4_988_310_000n; // EUR 4,988.31

export function eurToMicro(eur: number): bigint {
  return BigInt(Math.round(eur * 1_000_000));
}

/** Deterministic E.164 number `i` of a country list. */
export function demoNumber(list: Pick<CountryList, "prefix" | "digits" | "start">, i: number) {
  return `${list.prefix}${String(list.start + i).padStart(list.digits, "0")}`;
}

export interface SeedSummary {
  organisations: Record<string, string>;
  contacts: number;
  routes: number;
}

export async function seedDemo(db: Db): Promise<SeedSummary> {
  const orgs = await seedOrganisations(db);
  const external = orgs.external;
  if (!external) throw new Error("External organisation was not created");

  const contactsSeeded = await seedLists(db, external);
  await seedSenderIds(db, external);
  await seedLinks(db, external);
  const routesSeeded = await seedRoutes(db, external);
  await seedLedger(db, external);

  return { organisations: orgs, contacts: contactsSeeded, routes: routesSeeded };
}

async function seedOrganisations(db: Db): Promise<Record<string, string>> {
  const rows = [
    { clerkOrgId: "seed_org_external", name: "External", slug: "external" },
    { clerkOrgId: "seed_org_internal", name: "Internal", slug: "internal" },
  ];
  await db
    .insert(organisations)
    .values(rows.map((o) => ({ ...o, id: seedUuid(`org:${o.slug}`) })))
    .onConflictDoNothing();
  // Ids are looked up rather than assumed: an earlier seed may have used random ids.
  const found = await db
    .select({ id: organisations.id, slug: organisations.slug })
    .from(organisations)
    .where(
      inArray(
        organisations.clerkOrgId,
        rows.map((o) => o.clerkOrgId),
      ),
    );
  return Object.fromEntries(found.map((o) => [o.slug, o.id]));
}

async function seedLists(db: Db, organisationId: string): Promise<number> {
  let total = 0;
  for (const spec of COUNTRY_LISTS) {
    const name = `Roy Boy_${spec.tag}_14092026_Batch2`;
    const listId = seedUuid(`list:${organisationId}:${name}`);
    await db
      .insert(lists)
      .values({
        id: listId,
        organisationId,
        name,
        country: spec.country,
        numbersCount: spec.count,
        createdAt: SEED_DATE,
        lastUploadAt: SEED_DATE,
      })
      .onConflictDoNothing();

    const contactRows = Array.from({ length: spec.count }, (_, i) => {
      const e164 = demoNumber(spec, i);
      return {
        id: seedUuid(`contact:${organisationId}:${e164}`),
        organisationId,
        e164,
        country: spec.country,
        createdAt: SEED_DATE,
      };
    });
    for (const chunk of chunks(contactRows)) {
      await db.insert(contacts).values(chunk).onConflictDoNothing();
    }

    const memberRows = contactRows.map((c) => ({
      id: seedUuid(`member:${listId}:${c.id}`),
      organisationId,
      listId,
      contactId: c.id,
    }));
    for (const chunk of chunks(memberRows)) {
      await db.insert(listMembers).values(chunk).onConflictDoNothing();
    }
    total += spec.count;
  }
  return total;
}

async function seedSenderIds(db: Db, organisationId: string): Promise<void> {
  for (const spec of COUNTRY_LISTS) {
    const groupId = seedUuid(`sidgroup:${organisationId}:${spec.country}`);
    await db
      .insert(sidGroups)
      .values({ id: groupId, organisationId, name: `${spec.tag} Casino`, country: spec.country })
      .onConflictDoNothing();
    await db
      .insert(senderIds)
      .values(
        spec.senderIds.map((value) => ({
          id: seedUuid(`sid:${groupId}:${value}`),
          organisationId,
          sidGroupId: groupId,
          value,
        })),
      )
      .onConflictDoNothing();
  }
}

async function seedLinks(db: Db, organisationId: string): Promise<void> {
  await db
    .insert(links)
    .values(
      LINKS.map((l) => ({
        id: seedUuid(`link:${organisationId}:${l.name}`),
        organisationId,
        name: l.name,
        url: l.url,
        createdAt: SEED_DATE,
      })),
    )
    .onConflictDoNothing();
}

async function seedRoutes(db: Db, externalOrganisationId: string): Promise<number> {
  const routeRows = PLATFORM_ROUTES.map((r) => ({
    id: seedUuid(`route:platform:${r.name}`),
    organisationId: null,
    provider: "platform",
    name: r.name,
    country: r.prices[0]?.[0] ?? null,
    config: {},
  }));
  const customRoute = {
    id: seedUuid(`route:${externalOrganisationId}:23Telecom`),
    organisationId: externalOrganisationId,
    provider: "smpp",
    name: "23Telecom",
    country: null,
    config: { bind: "transceiver", port: 2775 },
  };
  await db
    .insert(routes)
    .values([...routeRows, customRoute])
    .onConflictDoNothing();

  const priceRows = PLATFORM_ROUTES.flatMap((r) =>
    r.prices.map(([country, eur]) => {
      const routeId = seedUuid(`route:platform:${r.name}`);
      return {
        id: seedUuid(`price:${routeId}:${country}:${PRICE_VALID_FROM.toISOString()}`),
        routeId,
        country,
        priceMicro: eurToMicro(eur),
        validFrom: PRICE_VALID_FROM,
      };
    }),
  );
  await db.insert(routePrices).values(priceRows).onConflictDoNothing();
  return routeRows.length + 1;
}

async function seedLedger(db: Db, organisationId: string): Promise<void> {
  await db
    .insert(ledgerEntries)
    .values({
      id: seedUuid(`ledger:${organisationId}:deposit:1`),
      organisationId,
      kind: "deposit",
      amountMicro: EXTERNAL_DEPOSIT_MICRO,
      referenceType: "manual",
      idempotencyKey: `seed:${organisationId}:deposit:1`,
      note: "Opening balance",
      createdAt: SEED_DATE,
    })
    .onConflictDoNothing();
}
