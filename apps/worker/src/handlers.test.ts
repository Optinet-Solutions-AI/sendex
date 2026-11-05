import { describe, expect, it } from "vitest";
import { createHandlers } from "./handlers.js";
import type { LogFields, LogLevel } from "./log.js";

describe("createHandlers (stubs)", () => {
  it("logs every job with its ids and resolves", async () => {
    const lines: Array<{ level: LogLevel; msg: string; fields?: LogFields }> = [];
    const handlers = createHandlers((level, msg, fields) => {
      lines.push(fields === undefined ? { level, msg } : { level, msg, fields });
    });
    const meta = { id: "1", name: "x", attemptsMade: 0 };

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
    await handlers.scheduledSend({ organisationId: "org", campaignId: "cmp" }, meta);

    expect(lines).toHaveLength(5);
    expect(lines.map((l) => l.level)).toEqual(["info", "info", "info", "info", "info"]);
    expect(lines[0]?.fields).toMatchObject({ jobId: "1", lapId: "lap" });
    expect(lines[2]?.fields).toMatchObject({ clicks: 1 });
    // Raw receipts can carry phone numbers: they must not reach the log.
    expect(JSON.stringify(lines)).not.toContain("+34612345678");
  });
});
