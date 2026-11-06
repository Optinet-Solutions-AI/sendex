import { deriveEventKey } from "@sendex/core";
import { laps, postbacks } from "@sendex/db";
import { createTestDb, type TestDb } from "@sendex/db/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTrackedMessage, type TrackedMessageSeed } from "../links/test-seed.js";
import { createPostbackIngestHandler, type PostbackIngestPayload } from "./ingest.js";

let t: TestDb;
let seed: TrackedMessageSeed;

beforeAll(async () => {
  t = await createTestDb();
  seed = await seedTrackedMessage(t.db);
});

afterAll(async () => {
  await t.close();
});

type LogLine = { level: string; msg: string; fields: Record<string, unknown> };

function build() {
  const lines: LogLine[] = [];
  const handler = createPostbackIngestHandler(t.db, (level, msg, fields = {}) => {
    lines.push({ level, msg, fields });
  });
  return { handler, lines };
}

async function payload(
  overrides: Partial<PostbackIngestPayload> = {},
): Promise<PostbackIngestPayload> {
  const type = overrides.type ?? "registration";
  return {
    organisationId: seed.organisationId,
    eventKey: await deriveEventKey({
      organisationId: seed.organisationId,
      type: type === "registration" ? "lead" : "sale",
      dynamicId: overrides.dynamicId ?? seed.dynamicId,
    }),
    type,
    dynamicId: seed.dynamicId,
    params: { type, dynamic_id: seed.dynamicId },
    ...overrides,
  };
}

async function lap() {
  const [row] = await t.db.select().from(laps).where(eq(laps.id, seed.lapId));
  if (!row) throw new Error("lap missing");
  return row;
}

describe("postback ingest handler", () => {
  it("stores a registration as a lead, attributes it to the message and counts the lap", async () => {
    const { handler, lines } = build();
    const job = await payload();
    await handler(job, { id: "1", name: "postback", attemptsMade: 0 });

    const [stored] = await t.db
      .select()
      .from(postbacks)
      .where(eq(postbacks.eventKey, job.eventKey));
    expect(stored).toMatchObject({
      organisationId: seed.organisationId,
      type: "lead",
      dynamicId: seed.dynamicId,
      messageId: seed.messageId,
      campaignId: seed.campaignId,
      lapId: seed.lapId,
      valueMicro: null,
    });
    expect((await lap()).leads).toBe(1);
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "info",
        msg: "postback ingested",
        fields: expect.objectContaining({
          eventKey: job.eventKey,
          inserted: true,
          attributed: true,
        }),
      }),
    );
  });

  it("ignores a replay of the same event", async () => {
    const { handler, lines } = build();
    await handler(await payload(), { id: "2", name: "postback", attemptsMade: 0 });
    expect((await lap()).leads).toBe(1);
    expect(lines[0]?.fields).toMatchObject({ inserted: false, attributed: false });
  });

  it("stores a sale with its value on the lap", async () => {
    const { handler } = build();
    await handler(await payload({ type: "sale", valueMicro: 12_500_000 }), {
      id: "3",
      name: "postback",
      attemptsMade: 0,
    });
    const row = await lap();
    expect(row.sales).toBe(1);
    expect(row.revenueMicro).toBe(12_500_000n);
  });

  it("keeps an unknown dynamic id unattributed and says so in the log", async () => {
    const { handler, lines } = build();
    const job = await payload({ dynamicId: "never-sent" });
    await handler(job, { id: "4", name: "postback", attemptsMade: 0 });
    const [stored] = await t.db
      .select()
      .from(postbacks)
      .where(eq(postbacks.eventKey, job.eventKey));
    expect(stored?.messageId).toBeNull();
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "warn",
        msg: "postback not attributed",
        fields: expect.objectContaining({ eventKey: job.eventKey }),
      }),
    );
  });

  it("fails loudly when the job carries no organisation id", async () => {
    const { handler } = build();
    const { organisationId: _dropped, ...job } = await payload();
    await expect(
      handler(job as PostbackIngestPayload, { id: "5", name: "postback", attemptsMade: 0 }),
    ).rejects.toThrow(/organisationId/);
  });
});
