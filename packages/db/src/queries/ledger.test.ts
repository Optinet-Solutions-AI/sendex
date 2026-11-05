import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { campaigns, laps } from "../schema/campaigns.js";
import { ledgerEntries } from "../schema/ledger.js";
import { contacts, lists } from "../schema/lists.js";
import { routes } from "../schema/routes.js";
import { messages } from "../schema/tracking.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  DuplicateDepositError,
  dailySummary,
  getBalanceMicro,
  listLedgerEntries,
  recordDeposit,
  spendByCampaign,
} from "./ledger.js";

let t: TestDb;
let orgA: string;
let orgB: string;
let campaignOne: string;
let campaignTwo: string;

const DAY1 = new Date("2026-11-01T09:00:00Z");
const DAY2 = new Date("2026-11-02T09:00:00Z");
const DAY3 = new Date("2026-11-03T23:30:00Z");

async function seedCampaign(org: string, name: string): Promise<string> {
  const [row] = await t.db
    .insert(campaigns)
    .values({ organisationId: org, name, country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  if (!row) throw new Error("campaign insert failed");
  return row.id;
}

async function seedMessages(org: string, campaignId: string, count: number): Promise<string[]> {
  const [list] = await t.db
    .insert(lists)
    .values({ organisationId: org, name: `list ${campaignId}`, country: "ES" })
    .returning({ id: lists.id });
  const [route] = await t.db
    .insert(routes)
    .values({ provider: "platform", name: `r ${campaignId}`, country: "ES" })
    .returning({ id: routes.id });
  if (!list || !route) throw new Error("list/route insert failed");
  const [lap] = await t.db
    .insert(laps)
    .values({
      organisationId: org,
      campaignId,
      listId: list.id,
      routeId: route.id,
      testSize: 10,
    })
    .returning({ id: laps.id });
  if (!lap) throw new Error("lap insert failed");
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const [contact] = await t.db
      .insert(contacts)
      .values({ organisationId: org, e164: `+3460${campaignId.slice(0, 4)}${i}`, country: "ES" })
      .returning({ id: contacts.id });
    if (!contact) throw new Error("contact insert failed");
    const [message] = await t.db
      .insert(messages)
      .values({
        organisationId: org,
        campaignId,
        lapId: lap.id,
        contactId: contact.id,
        e164: `+3460${i}`,
        senderId: "SENDEX",
        text: "hi",
        encoding: "GSM_7BIT",
        routeId: route.id,
        idempotencyKey: `${lap.id}:${contact.id}`,
      })
      .returning({ id: messages.id });
    if (!message) throw new Error("message insert failed");
    ids.push(message.id);
  }
  return ids;
}

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");
  campaignOne = await seedCampaign(orgA, "Spain One");
  campaignTwo = await seedCampaign(orgA, "Spain Two");
  const [m1, m2, m3] = await seedMessages(orgA, campaignOne, 3);
  const [m4] = await seedMessages(orgA, campaignTwo, 1);
  if (!m1 || !m2 || !m3 || !m4) throw new Error("seed failed");

  await t.db.insert(ledgerEntries).values([
    {
      organisationId: orgA,
      kind: "deposit",
      amountMicro: 100_000_000n,
      referenceType: "manual",
      idempotencyKey: "seed:a:1",
      note: "Opening balance",
      createdAt: DAY1,
    },
    {
      organisationId: orgA,
      kind: "debit",
      amountMicro: -25_000n,
      referenceType: "message",
      referenceId: m1,
      idempotencyKey: `debit:${m1}`,
      createdAt: DAY2,
    },
    {
      organisationId: orgA,
      kind: "debit",
      amountMicro: -25_000n,
      referenceType: "message",
      referenceId: m2,
      idempotencyKey: `debit:${m2}`,
      createdAt: DAY2,
    },
    {
      organisationId: orgA,
      kind: "refund",
      amountMicro: 25_000n,
      referenceType: "message",
      referenceId: m2,
      idempotencyKey: `refund:${m2}`,
      createdAt: new Date(DAY2.getTime() + 60_000),
    },
    {
      organisationId: orgA,
      kind: "debit",
      amountMicro: -27_000n,
      referenceType: "message",
      referenceId: m3,
      idempotencyKey: `debit:${m3}`,
      createdAt: DAY3,
    },
    {
      organisationId: orgA,
      kind: "debit",
      amountMicro: -30_000n,
      referenceType: "message",
      referenceId: m4,
      idempotencyKey: `debit:${m4}`,
      createdAt: DAY3,
    },
    {
      organisationId: orgA,
      kind: "adjustment",
      amountMicro: -1_000_000n,
      referenceType: "manual",
      idempotencyKey: "adj:a:1",
      note: "Correction",
      createdAt: DAY3,
    },
    {
      organisationId: orgB,
      kind: "deposit",
      amountMicro: 5_000_000n,
      referenceType: "manual",
      idempotencyKey: "seed:b:1",
      createdAt: DAY2,
    },
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("listLedgerEntries", () => {
  it("returns the organisation's entries newest first with a total", async () => {
    const result = await listLedgerEntries(t.db, orgA, { page: 1, pageSize: 3 });
    expect(result.total).toBe(7);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.createdAt.getTime())).toEqual(
      [DAY3, DAY3, DAY3].map((d) => d.getTime()),
    );
    expect(result.rows.every((r) => typeof r.amountMicro === "bigint")).toBe(true);
    const page3 = await listLedgerEntries(t.db, orgA, { page: 3, pageSize: 3 });
    expect(page3.rows).toHaveLength(1);
    expect(page3.rows[0]?.note).toBe("Opening balance");
  });

  it("filters by kind and date range and never leaks another organisation", async () => {
    const debits = await listLedgerEntries(t.db, orgA, { kind: "debit", page: 1, pageSize: 50 });
    expect(debits.total).toBe(4);
    expect(debits.rows.every((r) => r.kind === "debit")).toBe(true);

    const day2 = await listLedgerEntries(t.db, orgA, {
      from: new Date("2026-11-02T00:00:00Z"),
      to: new Date("2026-11-03T00:00:00Z"),
      page: 1,
      pageSize: 50,
    });
    expect(day2.total).toBe(3);

    const other = await listLedgerEntries(t.db, orgB, { page: 1, pageSize: 50 });
    expect(other.total).toBe(1);
    expect(other.rows[0]?.amountMicro).toBe(5_000_000n);
  });
});

describe("recordDeposit", () => {
  it("writes a deposit entry keyed by the reference and raises the balance", async () => {
    const before = await getBalanceMicro(t.db, orgB);
    const entry = await recordDeposit(t.db, orgB, {
      amountMicro: 25_000_000n,
      method: "wire",
      reference: "WIRE-2026-11-06-1",
      note: "November top-up",
      actorUserId: null,
    });
    expect(entry.kind).toBe("deposit");
    expect(entry.amountMicro).toBe(25_000_000n);
    expect(entry.referenceType).toBe("wire");
    expect(entry.referenceId).toBe("WIRE-2026-11-06-1");
    expect(entry.idempotencyKey).toBe("deposit:WIRE-2026-11-06-1");
    expect(entry.note).toBe("November top-up");
    expect(await getBalanceMicro(t.db, orgB)).toBe(before + 25_000_000n);
  });

  it("rejects a repeated reference with a typed error, even from another organisation", async () => {
    const again = recordDeposit(t.db, orgB, {
      amountMicro: 1_000_000n,
      method: "manual",
      reference: "WIRE-2026-11-06-1",
      note: null,
      actorUserId: null,
    });
    await expect(again).rejects.toBeInstanceOf(DuplicateDepositError);
    const cross = recordDeposit(t.db, orgA, {
      amountMicro: 1_000_000n,
      method: "manual",
      reference: "WIRE-2026-11-06-1",
      note: null,
      actorUserId: null,
    });
    await expect(cross).rejects.toBeInstanceOf(DuplicateDepositError);
    expect(await getBalanceMicro(t.db, orgB)).toBe(30_000_000n);
  });

  it("rejects a non-positive amount", async () => {
    await expect(
      recordDeposit(t.db, orgB, {
        amountMicro: 0n,
        method: "manual",
        reference: "zero",
        note: null,
        actorUserId: null,
      }),
    ).rejects.toThrow(/positive/);
  });
});

describe("dailySummary", () => {
  it("groups deposits, debits, refunds and net per UTC day, oldest first", async () => {
    const rows = await dailySummary(t.db, orgA, {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-11-04T00:00:00Z"),
    });
    expect(rows).toEqual([
      {
        day: "2026-11-01",
        depositsMicro: 100_000_000n,
        debitsMicro: 0n,
        refundsMicro: 0n,
        adjustmentsMicro: 0n,
        netMicro: 100_000_000n,
        entries: 1,
      },
      {
        day: "2026-11-02",
        depositsMicro: 0n,
        debitsMicro: -50_000n,
        refundsMicro: 25_000n,
        adjustmentsMicro: 0n,
        netMicro: -25_000n,
        entries: 3,
      },
      {
        day: "2026-11-03",
        depositsMicro: 0n,
        debitsMicro: -57_000n,
        refundsMicro: 0n,
        adjustmentsMicro: -1_000_000n,
        netMicro: -1_057_000n,
        entries: 3,
      },
    ]);
  });

  it("respects the range and the organisation", async () => {
    const rows = await dailySummary(t.db, orgA, {
      from: new Date("2026-11-03T00:00:00Z"),
      to: new Date("2026-11-04T00:00:00Z"),
    });
    expect(rows.map((r) => r.day)).toEqual(["2026-11-03"]);
    const other = await dailySummary(t.db, orgB, {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date(Date.now() + 86_400_000),
    });
    expect(other.map((r) => [r.day, r.depositsMicro])).toEqual([
      ["2026-11-02", 5_000_000n],
      [new Date().toISOString().slice(0, 10), 25_000_000n],
    ]);
  });
});

describe("spendByCampaign", () => {
  it("sums message debits and refunds per campaign", async () => {
    const rows = await spendByCampaign(t.db, orgA, {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-11-04T00:00:00Z"),
    });
    expect(rows).toEqual([
      {
        campaignId: campaignOne,
        campaignName: "Spain One",
        debitsMicro: -77_000n,
        refundsMicro: 25_000n,
        netMicro: -52_000n,
        messages: 3,
      },
      {
        campaignId: campaignTwo,
        campaignName: "Spain Two",
        debitsMicro: -30_000n,
        refundsMicro: 0n,
        netMicro: -30_000n,
        messages: 1,
      },
    ]);
  });

  it("only counts entries inside the range", async () => {
    const rows = await spendByCampaign(t.db, orgA, {
      from: new Date("2026-11-02T00:00:00Z"),
      to: new Date("2026-11-03T00:00:00Z"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.campaignId).toBe(campaignOne);
    expect(rows[0]?.netMicro).toBe(-25_000n);
    expect(rows[0]?.messages).toBe(2);
  });
});
