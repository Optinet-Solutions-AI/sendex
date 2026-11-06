import { laps, messages } from "@sendex/db";
import { createTestDb, type TestDb } from "@sendex/db/test";
import {
  createProviderRegistry,
  type DeliveryReceipt,
  FakeProvider,
  type Provider,
} from "@sendex/providers";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTrackedMessage, type TrackedMessageSeed } from "../links/test-seed.js";
import type { LogFields, LogLevel } from "../log.js";
import { createReceiptPollTick } from "./poll.js";

let t: TestDb;
let seed: TrackedMessageSeed;

const T0 = new Date("2026-11-06T15:30:00.000Z");
const MINUTE = 60_000;

/** A provider that answers status polls from a script and records what it was asked. */
function pollingProvider(
  answer: (ids: readonly string[]) => Promise<DeliveryReceipt[]>,
): Provider & { asked: string[][] } {
  const asked: string[][] = [];
  const base = new FakeProvider();
  return {
    name: "fake",
    asked,
    send: (batch) => base.send(batch),
    parseDeliveryReceipt: (raw) => base.parseDeliveryReceipt(raw),
    priceFor: (route, country) => base.priceFor(route, country),
    validateSenderId: (senderId, country) => base.validateSenderId(senderId, country),
    pollReceipts: async (ids) => {
      asked.push([...ids]);
      return answer(ids);
    },
  };
}

function capture() {
  const lines: Array<{ level: LogLevel; msg: string; fields?: LogFields }> = [];
  const log = (level: LogLevel, msg: string, fields?: LogFields) => {
    lines.push(fields === undefined ? { level, msg } : { level, msg, fields });
  };
  return { lines, log };
}

beforeAll(async () => {
  t = await createTestDb();
  // The seed's route is served by the "fake" provider.
  seed = await seedTrackedMessage(t.db);
  await t.db
    .update(messages)
    .set({ status: "sent", providerMessageId: "p-1", sentAt: new Date(T0.getTime() - 15 * MINUTE) })
    .where(eq(messages.id, seed.messageId));
  await t.db.update(laps).set({ sent: 1 }).where(eq(laps.id, seed.lapId));
});

afterAll(async () => {
  await t.close();
});

describe("createReceiptPollTick", () => {
  it("skips providers that cannot be polled and messages younger than the grace period", async () => {
    const provider = pollingProvider(async () => []);
    const providers = createProviderRegistry()
      .register("platform", new FakeProvider())
      .register("fake", provider);
    const { lines, log } = capture();
    const tick = createReceiptPollTick({
      db: t.db,
      providers,
      log,
      afterMs: 20 * MINUTE,
      everyMs: MINUTE,
      now: () => T0,
    });
    expect(await tick()).toEqual({ polled: 0, applied: 0, ignored: 0, unknown: 0 });
    expect(provider.asked).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("logs a carrier failure, leaves the message as sent, and does not throw", async () => {
    const provider = pollingProvider(async () => {
      throw new Error("23telecom status lookup answered 503 SANDBOX_BUSY");
    });
    const providers = createProviderRegistry().register("fake", provider);
    const { lines, log } = capture();
    const tick = createReceiptPollTick({
      db: t.db,
      providers,
      log,
      afterMs: 10 * MINUTE,
      everyMs: MINUTE,
      now: () => T0,
    });
    expect(await tick()).toEqual({ polled: 1, applied: 0, ignored: 0, unknown: 0 });
    expect(provider.asked).toEqual([["p-1"]]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      msg: "receipt poll failed",
      fields: { provider: "fake", polled: 1 },
    });
    const [message] = await t.db.select().from(messages).where(eq(messages.id, seed.messageId));
    expect(message?.status).toBe("sent");
  });

  it("applies the final receipts the carrier reports, counts them on the lap, and throttles itself", async () => {
    const at = new Date("2026-11-06T15:16:00.000Z");
    const provider = pollingProvider(async (ids) =>
      ids.map((providerMessageId) => ({ providerMessageId, status: "delivered", at })),
    );
    const providers = createProviderRegistry().register("fake", provider);
    const { lines, log } = capture();
    let now = T0;
    const tick = createReceiptPollTick({
      db: t.db,
      providers,
      log,
      afterMs: 10 * MINUTE,
      everyMs: MINUTE,
      now: () => now,
    });

    expect(await tick()).toEqual({ polled: 1, applied: 1, ignored: 0, unknown: 0 });
    expect(provider.asked).toEqual([["p-1"]]);
    const [message] = await t.db.select().from(messages).where(eq(messages.id, seed.messageId));
    expect(message).toMatchObject({ status: "delivered", deliveredAt: at });
    const [lap] = await t.db.select().from(laps).where(eq(laps.id, seed.lapId));
    expect(lap).toMatchObject({ sent: 1, delivered: 1, failed: 0 });
    expect(lines).toEqual([
      {
        level: "info",
        msg: "receipts polled",
        fields: { provider: "fake", polled: 1, final: 1, applied: 1, ignored: 0, unknown: 0 },
      },
    ]);

    // Within the interval nothing runs; after it, there is nothing left to ask about.
    now = new Date(T0.getTime() + 30_000);
    expect(await tick()).toEqual({ polled: 0, applied: 0, ignored: 0, unknown: 0 });
    now = new Date(T0.getTime() + 61_000);
    expect(await tick()).toEqual({ polled: 0, applied: 0, ignored: 0, unknown: 0 });
    expect(provider.asked).toHaveLength(1);
  });
});
