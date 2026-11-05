import { clicks, laps } from "@sendex/db";
import { createTestDb, type TestDb } from "@sendex/db/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import type { LogFields, LogLevel } from "../log.js";
import type { JobHandler } from "../queues.js";
import { clickBatchSchema, createClickIngestHandler, ingestClicks } from "./ingest.js";
import { seedTrackedMessage, type TrackedMessageSeed } from "./test-seed.js";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

let t: TestDb;
let seed: TrackedMessageSeed;

beforeAll(async () => {
  t = await createTestDb();
  seed = await seedTrackedMessage(t.db);
});

afterAll(async () => {
  await t.close();
});

async function lapClicks(): Promise<number | undefined> {
  const [lap] = await t.db
    .select({ clicks: laps.clicks })
    .from(laps)
    .where(eq(laps.id, seed.lapId));
  return lap?.clicks;
}

describe("clickBatchSchema", () => {
  it("accepts the links service record and rejects an empty batch", () => {
    expect(
      clickBatchSchema.safeParse({
        clicks: [
          {
            shortCode: "abcdefgh",
            clickedAt: "2026-11-06T10:00:00.000Z",
            ip: "203.0.113.9",
            userAgent: IPHONE,
            country: "ES",
            device: "mobile",
            asn: "Vodafone Spain",
          },
        ],
      }).success,
    ).toBe(true);
    expect(clickBatchSchema.safeParse({ clicks: [] }).success).toBe(false);
    expect(
      clickBatchSchema.safeParse({ clicks: [{ shortCode: "x", clickedAt: "yesterday", ip: "1" }] })
        .success,
    ).toBe(false);
  });
});

describe("ingestClicks", () => {
  it("stores known clicks with their context, skips unknown codes and counts the lap", async () => {
    const result = await ingestClicks(t.db, {
      clicks: [
        {
          shortCode: seed.shortCode,
          clickedAt: "2026-11-06T10:00:00.000Z",
          ip: "203.0.113.9",
          userAgent: IPHONE,
          country: "es",
          device: "mobile",
          asn: "Vodafone Spain",
        },
        {
          shortCode: seed.shortCode,
          clickedAt: "2026-11-06T10:00:01.000Z",
          ip: "unknown",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
        },
        {
          shortCode: "zzzzzzzz",
          clickedAt: "2026-11-06T10:00:02.000Z",
          ip: "203.0.113.10",
          userAgent: IPHONE,
        },
      ],
    });
    expect(result).toEqual({ inserted: 2, unknown: 1 });

    const rows = await t.db
      .select()
      .from(clicks)
      .where(eq(clicks.messageId, seed.messageId))
      .orderBy(clicks.at);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      organisationId: seed.organisationId,
      campaignId: seed.campaignId,
      lapId: seed.lapId,
      at: new Date("2026-11-06T10:00:00.000Z"),
      ip: "203.0.113.9",
      country: "ES",
      userAgent: IPHONE,
      device: "mobile",
      operator: "Vodafone Spain",
    });
    // No device from the edge: classified here. No ip or geo: null, not "unknown".
    expect(rows[1]).toMatchObject({
      at: new Date("2026-11-06T10:00:01.000Z"),
      ip: null,
      country: null,
      device: "desktop",
      operator: null,
    });
    // Two clicks on one message: two rows, one click for the lap (D2-13).
    await expect(lapClicks()).resolves.toBe(1);
  });

  it("keeps the lap counter at one per message on a later batch and tolerates all-unknown batches", async () => {
    await ingestClicks(t.db, {
      clicks: [
        {
          shortCode: seed.shortCode,
          clickedAt: "2026-11-06T11:00:00.000Z",
          ip: "203.0.113.9",
          userAgent: IPHONE,
        },
      ],
    });
    await expect(
      ingestClicks(t.db, {
        clicks: [
          {
            shortCode: "yyyyyyyy",
            clickedAt: "2026-11-06T11:00:00.000Z",
            ip: "1.1.1.1",
            userAgent: "",
          },
        ],
      }),
    ).resolves.toEqual({ inserted: 0, unknown: 1 });
    await expect(lapClicks()).resolves.toBe(1);
  });

  it("drops a country that is not two letters", async () => {
    await ingestClicks(t.db, {
      clicks: [
        {
          shortCode: seed.shortCode,
          clickedAt: "2026-11-06T12:00:00.000Z",
          ip: "203.0.113.9",
          userAgent: IPHONE,
          country: "XX1",
        },
      ],
    });
    const rows = await t.db
      .select({ country: clicks.country })
      .from(clicks)
      .where(eq(clicks.at, new Date("2026-11-06T12:00:00.000Z")));
    expect(rows).toEqual([{ country: null }]);
  });
});

describe("createClickIngestHandler", () => {
  it("can be wired as the clickIngest job handler", () => {
    expectTypeOf(createClickIngestHandler(t.db)).toMatchTypeOf<JobHandler<"clickIngest">>();
  });

  it("ingests the job, counts a first click on its lap and logs counts only, never the records", async () => {
    const lines: Array<{ level: LogLevel; msg: string; fields?: LogFields }> = [];
    const handler = createClickIngestHandler(t.db, (level, msg, fields) => {
      lines.push(fields === undefined ? { level, msg } : { level, msg, fields });
    });
    // A message nobody has clicked yet, on its own lap.
    const fresh = await seedTrackedMessage(t.db, { shortCode: "bcdefghj" });
    await expect(
      handler({
        clicks: [
          {
            shortCode: fresh.shortCode,
            clickedAt: "2026-11-06T13:00:00.000Z",
            ip: "203.0.113.77",
            userAgent: IPHONE,
          },
          {
            shortCode: "zzzzzzzz",
            clickedAt: "2026-11-06T13:00:00.000Z",
            ip: "1.1.1.1",
            userAgent: "",
          },
        ],
      }),
    ).resolves.toBeUndefined();
    const [freshLap] = await t.db
      .select({ clicks: laps.clicks })
      .from(laps)
      .where(eq(laps.id, fresh.lapId));
    expect(freshLap?.clicks).toBe(1);
    expect(lines).toEqual([
      { level: "info", msg: "clicks ingested", fields: { received: 2, inserted: 1, unknown: 1 } },
    ]);
    expect(JSON.stringify(lines)).not.toContain("203.0.113.77");
  });
});
