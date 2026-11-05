import { describe, expect, it } from "vitest";
import {
  parseClickIngestJob,
  parseDlrJob,
  parseJob,
  parsePostbackIngestJob,
  parseScheduledSendJob,
  parseSendLapJob,
} from "./jobs.js";

describe("job payload schemas", () => {
  it("parses a valid SendLapJob", () => {
    const job = parseSendLapJob({
      organisationId: "org_1",
      campaignId: "cmp_1",
      lapId: "lap_1",
      idempotencyKey: "cmp_1:lap_1",
    });
    expect(job).toEqual({
      organisationId: "org_1",
      campaignId: "cmp_1",
      lapId: "lap_1",
      idempotencyKey: "cmp_1:lap_1",
    });
  });

  it("rejects a SendLapJob with a missing or empty field", () => {
    expect(() => parseSendLapJob({ organisationId: "org_1", campaignId: "cmp_1" })).toThrow();
    expect(() =>
      parseSendLapJob({ organisationId: "", campaignId: "c", lapId: "l", idempotencyKey: "k" }),
    ).toThrow();
  });

  it("names the queue in the error for an invalid payload", () => {
    expect(() => parseSendLapJob(null)).toThrowError(/invalid "send" job payload/i);
  });

  it("parses a DlrJob and keeps the raw receipt untouched", () => {
    const raw = { id: "abc", stat: "DELIVRD" };
    expect(parseDlrJob({ provider: "fake", raw })).toEqual({ provider: "fake", raw });
    expect(() => parseDlrJob({ raw })).toThrow();
  });

  it("parses a ClickIngestJob with at least one click", () => {
    const click = {
      shortCode: "abc123",
      clickedAt: "2026-11-06T10:00:00.000Z",
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0",
    };
    expect(parseClickIngestJob({ clicks: [click] })).toEqual({ clicks: [click] });
    expect(() => parseClickIngestJob({ clicks: [] })).toThrow();
    expect(() => parseClickIngestJob({ clicks: [{ shortCode: "x" }] })).toThrow();
  });

  it("parses a PostbackIngestJob with an optional valueMicro", () => {
    const base = {
      eventKey: "evt_1",
      type: "registration",
      dynamicId: "dyn_1",
      params: { source: "landing" },
    };
    expect(parsePostbackIngestJob(base)).toEqual(base);
    expect(parsePostbackIngestJob({ ...base, type: "sale", valueMicro: 12_500_000 })).toEqual({
      ...base,
      type: "sale",
      valueMicro: 12_500_000,
    });
    expect(() => parsePostbackIngestJob({ ...base, type: "refund" })).toThrow();
    expect(() => parsePostbackIngestJob({ ...base, valueMicro: 1.5 })).toThrow();
    expect(() => parsePostbackIngestJob({ ...base, valueMicro: -1 })).toThrow();
  });

  it("parses a ScheduledSendJob", () => {
    expect(parseScheduledSendJob({ kind: "dispatch-laps" })).toEqual({ kind: "dispatch-laps" });
    expect(() => parseScheduledSendJob({ organisationId: "org_1" })).toThrow();
  });

  it("parses by queue key", () => {
    expect(parseJob("scheduledSend", { kind: "dispatch-laps" })).toEqual({
      kind: "dispatch-laps",
    });
    expect(() => parseJob("dlr", {})).toThrowError(/invalid "dlr" job payload/i);
  });
});
