import { laps, messages, NO_RECEIPT_ERROR_CODE } from "@sendex/db";
import { createTestDb, type TestDb } from "@sendex/db/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTrackedMessage, type TrackedMessageSeed } from "../links/test-seed.js";
import type { LogFields, LogLevel } from "../log.js";
import { createExpiryTick } from "./expiry.js";

let t: TestDb;
let seed: TrackedMessageSeed;

const T0 = new Date("2026-11-06T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  t = await createTestDb();
  seed = await seedTrackedMessage(t.db);
  await t.db
    .update(messages)
    .set({ status: "sent", providerMessageId: "p-1", sentAt: new Date(T0.getTime() - 25 * HOUR) })
    .where(eq(messages.id, seed.messageId));
  await t.db.update(laps).set({ sent: 1 }).where(eq(laps.id, seed.lapId));
});

afterAll(async () => {
  await t.close();
});

describe("createExpiryTick", () => {
  it("expires sent messages past the window, counts them as failed, and runs at most once per interval", async () => {
    let now = T0;
    const lines: Array<{ level: LogLevel; msg: string; fields?: LogFields }> = [];
    const tick = createExpiryTick({
      db: t.db,
      log: (level, msg, fields) => {
        lines.push(fields === undefined ? { level, msg } : { level, msg, fields });
      },
      everyMs: 60_000,
      now: () => now,
    });

    expect(await tick()).toBe(1);
    const [message] = await t.db.select().from(messages).where(eq(messages.id, seed.messageId));
    expect(message).toMatchObject({ status: "expired", errorCode: NO_RECEIPT_ERROR_CODE });
    const [lap] = await t.db.select().from(laps).where(eq(laps.id, seed.lapId));
    expect(lap).toMatchObject({ sent: 1, delivered: 0, failed: 1 });
    expect(lines).toEqual([
      {
        level: "info",
        msg: "stale messages expired",
        fields: { expired: 1, olderThan: "2026-11-05T12:00:00.000Z" },
      },
    ]);

    // Within the interval the sweep is skipped; after it, it runs and finds nothing.
    now = new Date(T0.getTime() + 30_000);
    expect(await tick()).toBe(0);
    now = new Date(T0.getTime() + 61_000);
    expect(await tick()).toBe(0);
    expect(lines).toHaveLength(1);
  });
});
