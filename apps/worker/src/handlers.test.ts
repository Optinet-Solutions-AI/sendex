import { createProviderRegistry, FakeProvider } from "@sendex/providers";
import { describe, expect, it } from "vitest";
import { createHandlers, createStubHandlers } from "./handlers.js";
import type { LogFields, LogLevel } from "./log.js";
import { createProgressTracker } from "./send/progress.js";
import { fakeRedis } from "./send/redis.fake.js";
import { createFakeStore } from "./send/store.fake.js";

type Line = { level: LogLevel; msg: string; fields?: LogFields };

function collect(): { lines: Line[]; log: (l: LogLevel, m: string, f?: LogFields) => void } {
  const lines: Line[] = [];
  return {
    lines,
    log: (level, msg, fields) => {
      lines.push(fields === undefined ? { level, msg } : { level, msg, fields });
    },
  };
}

const meta = { id: "1", name: "x", attemptsMade: 0 };

describe("createStubHandlers", () => {
  it("logs every job with its ids and resolves", async () => {
    const { lines, log } = collect();
    const handlers = createStubHandlers(log);

    await handlers.send(
      { organisationId: "org", campaignId: "cmp", lapId: "lap", idempotencyKey: "k" },
      meta,
    );
    await handlers.dlr({ provider: "fake", raw: { to: "+34612345678" } }, meta);
    await handlers.clickIngest(
      {
        clicks: [
          { shortCode: "a", clickedAt: "2026-01-01T00:00:00.000Z", ip: "1.1.1.1", userAgent: "" },
        ],
      },
      meta,
    );
    await handlers.postbackIngest(
      { eventKey: "e", type: "sale", dynamicId: "d", valueMicro: 1, params: {} },
      meta,
    );
    await handlers.scheduledSend({ kind: "dispatch-laps" }, meta);

    expect(lines).toHaveLength(5);
    expect(lines[0]?.fields).toMatchObject({ jobId: "1", lapId: "lap" });
    expect(lines[2]?.fields).toMatchObject({ clicks: 1 });
    // Raw receipts can carry phone numbers: they must not reach the log.
    expect(JSON.stringify(lines)).not.toContain("+34612345678");
  });
});

describe("createHandlers", () => {
  it("wires the dispatcher and the send loop to the store, queue and provider", async () => {
    const { lines, log } = collect();
    const store = createFakeStore({
      ctx: {
        lap: {
          id: "lap-1",
          organisationId: "org-1",
          campaignId: "cmp-1",
          listId: "list-1",
          routeId: "route-1",
          testSize: 3,
          status: "queued",
          sent: 0,
          failed: 0,
          costMicro: 0n,
        },
        campaign: { id: "cmp-1", status: "sending", contactReuse: "account_wide" },
        list: { id: "list-1", country: "ES" },
        route: { id: "route-1", provider: "fake", name: "fake-1", active: true, config: {} },
        senderIds: ["LUCKY777"],
        texts: [{ id: "t", text: "hi" }],
        link: null,
        priceMicro: 25_000n,
      },
      members: [
        { contactId: "c1", e164: "+34600000001", firstName: null },
        { contactId: "c2", e164: "+34600000002", firstName: null },
        { contactId: "c3", e164: "+34600000003", firstName: null },
      ],
      balanceMicro: 1_000_000n,
    });
    const added: unknown[] = [];
    const redis = fakeRedis();
    const handlers = createHandlers({
      log,
      store,
      providers: createProviderRegistry().register("fake", new FakeProvider()),
      redis,
      progress: createProgressTracker(redis),
      sendQueue: {
        async add(name, data, opts) {
          added.push({ name, data, opts });
        },
      },
      send: { linksBaseUrl: "http://links.test" },
    });

    await handlers.scheduledSend({ kind: "dispatch-laps" }, meta);
    expect(added).toEqual([
      {
        name: "send-lap",
        data: {
          organisationId: "org-1",
          campaignId: "cmp-1",
          lapId: "lap-1",
          idempotencyKey: "lap:lap-1",
        },
        opts: { jobId: "lap-lap-1" },
      },
    ]);
    expect(store.lap.status).toBe("sending");

    await handlers.send(
      { organisationId: "org-1", campaignId: "cmp-1", lapId: "lap-1", idempotencyKey: "lap:lap-1" },
      meta,
    );
    expect(store.lap).toMatchObject({ status: "done", sent: 3, failed: 0 });
    expect(lines.at(-1)).toMatchObject({
      msg: "send lap finished",
      fields: { lapId: "lap-1", outcome: "done", sent: 3 },
    });
    expect(JSON.stringify(lines)).not.toContain("+34600000001");
  });
});
