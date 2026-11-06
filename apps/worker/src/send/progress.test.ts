import { describe, expect, it } from "vitest";
import { createProgressTracker, progressKeys } from "./progress.js";
import { fakeRedis } from "./redis.fake.js";

describe("progress tracker", () => {
  it("names the keys as documented", () => {
    expect(progressKeys.lap("L1")).toEqual({
      sent: "sendex:lap:L1:sent",
      failed: "sendex:lap:L1:failed",
      total: "sendex:lap:L1:total",
    });
    expect(progressKeys.campaign("C1").sent).toBe("sendex:campaign:C1:sent");
  });

  it("sets the lap total once and adds the delta to the campaign total", async () => {
    const redis = fakeRedis();
    const tracker = createProgressTracker(redis, { ttlSeconds: 60 });
    await tracker.setLapTotal("C1", "L1", 100);
    await tracker.setLapTotal("C1", "L2", 50);
    expect(redis.data.get("sendex:campaign:C1:total")).toBe("150");
    // Lowering a lap's total (list ran out) lowers the campaign total by the same amount.
    await tracker.setLapTotal("C1", "L1", 80);
    expect(redis.data.get("sendex:lap:L1:total")).toBe("80");
    expect(redis.data.get("sendex:campaign:C1:total")).toBe("130");
    expect(redis.ttls.get("sendex:lap:L1:total")).toBe(60);
    expect(redis.ttls.get("sendex:campaign:C1:total")).toBe(60);
  });

  it("records batches on the lap and the campaign", async () => {
    const redis = fakeRedis();
    const tracker = createProgressTracker(redis);
    await tracker.recordBatch("C1", "L1", { sent: 45, failed: 5 });
    await tracker.recordBatch("C1", "L1", { sent: 50, failed: 0 });
    await tracker.recordBatch("C1", "L2", { sent: 10, failed: 0 });
    expect(redis.data.get("sendex:lap:L1:sent")).toBe("95");
    expect(redis.data.get("sendex:lap:L1:failed")).toBe("5");
    expect(redis.data.get("sendex:campaign:C1:sent")).toBe("105");
    expect(redis.data.get("sendex:campaign:C1:failed")).toBe("5");
  });

  it("reads a campaign from Redis, falling back to the lap rows when keys are missing", async () => {
    const redis = fakeRedis();
    const tracker = createProgressTracker(redis);
    await tracker.setLapTotal("C1", "L1", 100);
    await tracker.recordBatch("C1", "L1", { sent: 45, failed: 5 });
    const progress = await tracker.readCampaign("C1", [
      { id: "L1", status: "sending", testSize: 100, sent: 40, failed: 5 },
      { id: "L2", status: "done", testSize: 30, sent: 28, failed: 2 },
    ]);
    expect(progress).toEqual({
      campaignId: "C1",
      sent: 45 + 28,
      failed: 5 + 2,
      total: 130,
      laps: [
        { lapId: "L1", status: "sending", sent: 45, failed: 5, total: 100 },
        { lapId: "L2", status: "done", sent: 28, failed: 2, total: 30 },
      ],
    });
  });
});
