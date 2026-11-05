import { laps, messages } from "@sendex/db";
import { createTestDb, type TestDb } from "@sendex/db/test";
import { createProviderRegistry, FakeProvider } from "@sendex/providers";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { seedTrackedMessage, type TrackedMessageSeed } from "../links/test-seed.js";
import type { LogFields, LogLevel } from "../log.js";
import type { JobHandler } from "../queues.js";
import { createDlrHandler } from "./handler.js";

type Line = { level: LogLevel; msg: string; fields?: LogFields };

let t: TestDb;
let seed: TrackedMessageSeed;
let lines: Line[];
let handler: ReturnType<typeof createDlrHandler>;

const providers = createProviderRegistry().register("fake", new FakeProvider());
const meta = (attemptsMade = 0) => ({ id: `job-${attemptsMade}`, name: "receipt", attemptsMade });

beforeAll(async () => {
  t = await createTestDb();
  seed = await seedTrackedMessage(t.db);
  await t.db
    .update(messages)
    .set({ status: "sent", providerMessageId: "fake-1", sentAt: new Date() })
    .where(eq(messages.id, seed.messageId));
  await t.db.update(laps).set({ sent: 1 }).where(eq(laps.id, seed.lapId));
  lines = [];
  handler = createDlrHandler({
    db: t.db,
    providers,
    log: (level, msg, fields) => {
      lines.push(fields === undefined ? { level, msg } : { level, msg, fields });
    },
  });
});

afterAll(async () => {
  await t.close();
});

async function lap() {
  const [row] = await t.db
    .select({ sent: laps.sent, delivered: laps.delivered, failed: laps.failed })
    .from(laps)
    .where(eq(laps.id, seed.lapId));
  return row;
}

describe("createDlrHandler", () => {
  it("can be wired as the dlr job handler", () => {
    expectTypeOf(handler).toMatchTypeOf<JobHandler<"dlr">>();
  });

  it("parses the receipt with the job's provider, applies it and logs ids only", async () => {
    await handler(
      { provider: "fake", raw: { id: "fake-1", stat: "DELIVRD", to: seed.e164 } },
      meta(),
    );
    const [message] = await t.db.select().from(messages).where(eq(messages.id, seed.messageId));
    expect(message).toMatchObject({ status: "delivered" });
    expect(message?.deliveredAt).toBeInstanceOf(Date);
    expect(await lap()).toEqual({ sent: 1, delivered: 1, failed: 0 });
    expect(lines.at(-1)).toMatchObject({
      level: "info",
      msg: "receipt applied",
      fields: {
        jobId: "job-0",
        provider: "fake",
        providerMessageId: "fake-1",
        status: "delivered",
        messageId: seed.messageId,
        lapId: seed.lapId,
      },
    });
    expect(JSON.stringify(lines)).not.toContain(seed.e164);
  });

  it("ignores a second receipt for a final message without touching the counters", async () => {
    await handler({ provider: "fake", raw: { id: "fake-1", stat: "UNDELIV" } }, meta());
    expect(await lap()).toEqual({ sent: 1, delivered: 1, failed: 0 });
    expect(lines.at(-1)).toMatchObject({
      msg: "receipt ignored, message already final",
      fields: { current: "delivered" },
    });
  });

  it("retries a receipt that matches no message yet, then drops it on the last attempt", async () => {
    const job = { provider: "fake", raw: { id: "not-yet", stat: "DELIVRD" } };
    await expect(handler(job, meta(0))).rejects.toThrow(/matched no message yet/);
    await expect(handler(job, meta(1))).rejects.toThrow(/matched no message yet/);
    await expect(handler(job, meta(2))).resolves.toBeUndefined();
    expect(lines.at(-1)).toMatchObject({
      level: "warn",
      msg: "receipt matched no message, dropped",
      fields: { providerMessageId: "not-yet", attemptsMade: 2 },
    });
  });

  it("fails without retry on an unknown provider or an unparseable receipt", async () => {
    await expect(handler({ provider: "nope", raw: {} }, meta())).rejects.toMatchObject({
      name: "UnrecoverableError",
    });
    await expect(handler({ provider: "fake", raw: "not a receipt" }, meta())).rejects.toMatchObject(
      { name: "UnrecoverableError" },
    );
  });
});
