import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DlrJob } from "../jobs.js";
import { createTelecom23WebhookRoutes, TELECOM23_DELIVERY_PATH } from "./telecom23.js";

const delivered = {
  message_id: "test_7_1784394012896569000_7c6d09d704f37e4b",
  recipient: "+34600000000",
  sender_id: "Sendex",
  status: "DELIVRD",
  status_code: "000",
  num_parts: 1,
  timestamp: "2026-02-13T10:30:04Z",
  sandbox: true,
};

function harness(opts: { secret?: string; failEnqueue?: boolean } = {}) {
  const jobs: DlrJob[] = [];
  const logs: Array<{ level: string; msg: string }> = [];
  const app = createTelecom23WebhookRoutes({
    ...(opts.secret ? { signingSecret: opts.secret } : {}),
    enqueue: async (job) => {
      if (opts.failEnqueue) throw new Error("redis down");
      jobs.push(job);
    },
    log: (level, msg) => logs.push({ level, msg }),
  });
  const post = (body: string, headers: Record<string, string> = {}) =>
    app.request(TELECOM23_DELIVERY_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  return { post, jobs, logs };
}

function sign(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

describe("POST /webhooks/23telecom/delivery", () => {
  it("queues a final delivery report under the 23telecom provider and answers 200", async () => {
    const h = harness();
    const res = await h.post(JSON.stringify(delivered));
    expect(res.status).toBe(200);
    expect(h.jobs).toEqual([{ provider: "23telecom", raw: delivered }]);
  });

  it("acknowledges intermediate states without queueing anything", async () => {
    const h = harness();
    for (const status of ["SENT", "ENROUTE", "ACCEPTD"]) {
      const res = await h.post(JSON.stringify({ ...delivered, status }));
      expect(res.status).toBe(200);
    }
    expect(h.jobs).toEqual([]);
  });

  it("rejects bodies that are not a delivery event", async () => {
    const h = harness();
    expect((await h.post("not json")).status).toBe(400);
    expect((await h.post(JSON.stringify({ status: "DELIVRD" }))).status).toBe(400);
    expect((await h.post(JSON.stringify([delivered]))).status).toBe(400);
    expect(h.jobs).toEqual([]);
  });

  it("verifies the HMAC signature and timestamp when a signing secret is configured", async () => {
    const secret = "whsec_test";
    const h = harness({ secret });
    const body = JSON.stringify(delivered);
    const ts = String(Math.floor(Date.now() / 1000));

    const ok = await h.post(body, {
      "x-webhook-timestamp": ts,
      "x-webhook-signature": sign(secret, ts, body),
    });
    expect(ok.status).toBe(200);

    const unsigned = await h.post(body);
    expect(unsigned.status).toBe(401);
    const wrong = await h.post(body, {
      "x-webhook-timestamp": ts,
      "x-webhook-signature": sign("other", ts, body),
    });
    expect(wrong.status).toBe(401);
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    const old = await h.post(body, {
      "x-webhook-timestamp": stale,
      "x-webhook-signature": sign(secret, stale, body),
    });
    expect(old.status).toBe(401);
    expect(h.jobs).toHaveLength(1);
  });

  it("answers 503 when the receipt cannot be queued so 23Telecom retries", async () => {
    const h = harness({ failEnqueue: true });
    const res = await h.post(JSON.stringify(delivered));
    expect(res.status).toBe(503);
    expect(h.logs.some((l) => l.level === "error")).toBe(true);
  });
});
