import { describe, expect, it } from "vitest";
import type { OutboundMessage } from "../provider.js";
import {
  isFinalDeliveryStatus,
  TELECOM23_BASE_URL,
  Telecom23Provider,
  telecom23IdempotencyKey,
} from "./telecom23-provider.js";

const msg = (id: string, to = "+34600000000", text = `hello ${id}`): OutboundMessage => ({
  id,
  to,
  senderId: "Sendex",
  text,
  encoding: "GSM_7BIT",
  route: "23t-es",
  country: "ES",
});

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** A fetch stub that records calls and answers with the given responses in order. */
function fakeFetch(responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift();
    if (next === undefined) throw new Error("no response scripted");
    calls.push({
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const accepted = (dnis: string, id: string) => ({
  dnis,
  message_id: id,
  segments: 1,
  status: "accepted",
});

describe("Telecom23Provider.send", () => {
  it("posts every message with its own text to /sms/send-individual with the API key", async () => {
    const { fetch, calls } = fakeFetch([
      {
        status: 200,
        body: {
          status: true,
          sandbox: true,
          results: [accepted("+34600000000", "test_1"), accepted("+34600000001", "test_2")],
        },
      },
    ]);
    const p = new Telecom23Provider({ apiKey: "sk_test_abc", fetch });
    const out = await p.send([msg("a"), msg("b", "+34600000001")]);

    expect(out).toEqual([
      { id: "a", status: "accepted", providerMessageId: "test_1" },
      { id: "b", status: "accepted", providerMessageId: "test_2" },
    ]);
    expect(calls).toHaveLength(1);
    const call = calls[0] as Call;
    expect(call.url).toBe(`${TELECOM23_BASE_URL}/sms/send-individual`);
    expect(call.init.method).toBe("POST");
    const headers = new Headers(call.init.headers);
    expect(headers.get("x-api-key")).toBe("sk_test_abc");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toBe(telecom23IdempotencyKey(["a", "b"]));
    expect(call.body).toEqual({
      messages: [
        { to: "+34600000000", message: "hello a", sender_id: "Sendex" },
        { to: "+34600000001", message: "hello b", sender_id: "Sendex" },
      ],
    });
  });

  it("maps per-recipient refusals: blocked_country is final, queue and db errors retry", async () => {
    const { fetch } = fakeFetch([
      {
        status: 200,
        body: {
          status: true,
          results: [
            { dnis: "+34600000000", status: "blocked_country" },
            { dnis: "+34600000001", status: "queue_error" },
            { dnis: "+34600000002", status: "db_error" },
            { dnis: "+34600000003", status: "message_too_long" },
          ],
        },
      },
    ]);
    const p = new Telecom23Provider({ apiKey: "k", fetch });
    const out = await p.send([
      msg("a"),
      msg("b", "+34600000001"),
      msg("c", "+34600000002"),
      msg("d", "+34600000003"),
    ]);
    expect(out).toEqual([
      { id: "a", status: "failed", reason: "BLOCKED_COUNTRY", retryable: false },
      { id: "b", status: "failed", reason: "QUEUE_ERROR", retryable: true },
      { id: "c", status: "failed", reason: "DB_ERROR", retryable: true },
      { id: "d", status: "failed", reason: "MESSAGE_TOO_LONG", retryable: false },
    ]);
  });

  it("matches results by position, then by number, and reports a missing result", async () => {
    const { fetch } = fakeFetch([
      {
        status: 200,
        body: { status: true, results: [accepted("+34600000001", "test_b")] },
      },
    ]);
    const p = new Telecom23Provider({ apiKey: "k", fetch });
    const out = await p.send([msg("a"), msg("b", "+34600000001")]);
    expect(out).toEqual([
      { id: "a", status: "failed", reason: "NO_RESULT", retryable: true },
      { id: "b", status: "accepted", providerMessageId: "test_b" },
    ]);
  });

  it("fails the whole batch on a rejected request and retries only on throttling and outages", async () => {
    const cases: Array<[number, string, boolean]> = [
      [401, "HTTP_401_UNAUTHORIZED", false],
      [403, "HTTP_403_FORBIDDEN", false],
      [400, "HTTP_400_INVALID_SENDER", false],
      [429, "HTTP_429_RATE_LIMITED", true],
      [503, "HTTP_503_SANDBOX_BUSY", true],
      [500, "HTTP_500_DB_ERROR", true],
    ];
    for (const [status, reason, retryable] of cases) {
      const code = reason.slice("HTTP_000_".length);
      const { fetch } = fakeFetch([{ status, body: { status: false, error_code: code } }]);
      const p = new Telecom23Provider({ apiKey: "k", fetch });
      const out = await p.send([msg("a")]);
      expect(out, `status ${status}`).toEqual([{ id: "a", status: "failed", reason, retryable }]);
    }
  });

  it("treats a network failure as retryable and never throws", async () => {
    const { fetch } = fakeFetch([new Error("ECONNRESET")]);
    const p = new Telecom23Provider({ apiKey: "k", fetch });
    await expect(p.send([msg("a")])).resolves.toEqual([
      { id: "a", status: "failed", reason: "NETWORK_ECONNRESET", retryable: true },
    ]);
  });

  it("splits a large batch into requests of at most maxPerRequest messages", async () => {
    const results = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) =>
        accepted(`+3460000${String(from + i).padStart(4, "0")}`, `t${from + i}`),
      );
    const { fetch, calls } = fakeFetch([
      { status: 200, body: { status: true, results: results(0, 100) } },
      { status: 200, body: { status: true, results: results(100, 20) } },
    ]);
    const p = new Telecom23Provider({ apiKey: "k", fetch });
    const batch = Array.from({ length: 120 }, (_, i) =>
      msg(`m${i}`, `+3460000${String(i).padStart(4, "0")}`),
    );
    const out = await p.send(batch);
    expect(calls.map((c) => (c.body.messages as unknown[]).length)).toEqual([100, 20]);
    expect(out.filter((o) => o.status === "accepted")).toHaveLength(120);
    expect(out[119]).toEqual({ id: "m119", status: "accepted", providerMessageId: "t119" });
  });

  it("uses the configured base url and strips a trailing slash", async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { status: true, results: [] } }]);
    const p = new Telecom23Provider({ apiKey: "k", fetch, baseUrl: "https://example.test/v1/" });
    await p.send([msg("a")]);
    expect(calls[0]?.url).toBe("https://example.test/v1/sms/send-individual");
  });
});

describe("Telecom23Provider.parseDeliveryReceipt", () => {
  const p = new Telecom23Provider({ apiKey: "k" });

  it("maps the delivery webhook payload to a receipt", () => {
    expect(
      p.parseDeliveryReceipt({
        message_id: "api_42_1",
        recipient: "+34600000000",
        status: "DELIVRD",
        status_code: "000",
        timestamp: "2026-02-13T10:30:04Z",
      }),
    ).toEqual({
      providerMessageId: "api_42_1",
      status: "delivered",
      at: new Date("2026-02-13T10:30:04Z"),
    });
  });

  it("maps failures and expiry, keeping the carrier code", () => {
    expect(
      p.parseDeliveryReceipt({ message_id: "x", status: "UNDELIV", status_code: "034" }),
    ).toMatchObject({
      status: "failed",
      errorCode: "034",
    });
    expect(p.parseDeliveryReceipt({ message_id: "x", status: "REJECTD" })).toMatchObject({
      status: "failed",
      errorCode: "REJECTD",
    });
    expect(p.parseDeliveryReceipt({ message_id: "x", status: "EXPIRED" })).toMatchObject({
      status: "expired",
    });
    expect(p.parseDeliveryReceipt({ message_id: "x", status: "credit_rejected" })).toMatchObject({
      status: "failed",
      errorCode: "credit_rejected",
    });
  });

  it("returns null for intermediate states and malformed payloads", () => {
    expect(p.parseDeliveryReceipt({ message_id: "x", status: "ENROUTE" })).toBeNull();
    expect(p.parseDeliveryReceipt({ message_id: "x", status: "SENT" })).toBeNull();
    expect(p.parseDeliveryReceipt({ status: "DELIVRD" })).toBeNull();
    expect(p.parseDeliveryReceipt("DELIVRD")).toBeNull();
    expect(p.parseDeliveryReceipt(null)).toBeNull();
  });

  it("falls back to now when the timestamp is missing or unreadable", () => {
    const before = Date.now();
    const r = p.parseDeliveryReceipt({
      message_id: "x",
      status: "DELIVRD",
      timestamp: "yesterday",
    });
    expect(r?.at.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("Telecom23Provider.pollReceipts", () => {
  const statusBody = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    status: 200,
    body: {
      status: true,
      sandbox: true,
      message: {
        message_id: id,
        recipient: "+34600000000",
        status,
        status_code: "000",
        delivered_at: "2026-11-06T15:11:19.485Z",
        ...extra,
      },
    },
  });

  it("asks /sms/status per id and returns receipts only for final states", async () => {
    const { fetch, calls } = fakeFetch([
      statusBody("test_1", "DELIVRD"),
      statusBody("test_2", "SENT"),
      statusBody("test_3", "UNDELIV", { status_code: "034" }),
      { status: 404, body: { status: false, error_code: "NOT_FOUND" } },
    ]);
    const p = new Telecom23Provider({ apiKey: "sk_test_abc", fetch, pollConcurrency: 2 });
    const out = await p.pollReceipts(["test_1", "test_2", "test_3", "gone/4"]);
    expect(out).toEqual([
      {
        providerMessageId: "test_1",
        status: "delivered",
        at: new Date("2026-11-06T15:11:19.485Z"),
      },
      {
        providerMessageId: "test_3",
        status: "failed",
        errorCode: "034",
        at: new Date("2026-11-06T15:11:19.485Z"),
      },
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      `${TELECOM23_BASE_URL}/sms/status/test_1`,
      `${TELECOM23_BASE_URL}/sms/status/test_2`,
      `${TELECOM23_BASE_URL}/sms/status/test_3`,
      `${TELECOM23_BASE_URL}/sms/status/gone%2F4`,
    ]);
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("x-api-key")).toBe("sk_test_abc");
    expect(calls[0]?.init.method).toBeUndefined();
  });

  it("retires sandbox ids under a live key without calling the API, and looks them up under a sandbox key", async () => {
    const live = fakeFetch([statusBody("api_9", "DELIVRD")]);
    const p = new Telecom23Provider({ apiKey: "sk_prod_x", fetch: live.fetch });
    const out = await p.pollReceipts(["test_267_1_a", "api_9", "test_267_1_b"]);
    expect(out.map(({ at, ...r }) => r)).toEqual([
      { providerMessageId: "test_267_1_a", status: "expired", errorCode: "SANDBOX_MESSAGE" },
      { providerMessageId: "test_267_1_b", status: "expired", errorCode: "SANDBOX_MESSAGE" },
      { providerMessageId: "api_9", status: "delivered" },
    ]);
    expect(live.calls.map((c) => c.url)).toEqual([`${TELECOM23_BASE_URL}/sms/status/api_9`]);

    const sandbox = fakeFetch([statusBody("test_267_1_a", "DELIVRD")]);
    const s = new Telecom23Provider({ apiKey: "sk_test_x", fetch: sandbox.fetch });
    expect(await s.pollReceipts(["test_267_1_a"])).toHaveLength(1);
    expect(sandbox.calls).toHaveLength(1);
  });

  it("looks up at most maxPollPerCall ids per call and leaves the rest for the next poll", async () => {
    const { fetch, calls } = fakeFetch([
      statusBody("a", "SENT"),
      statusBody("b", "SENT"),
      statusBody("c", "SENT"),
    ]);
    const p = new Telecom23Provider({ apiKey: "k", fetch, maxPollPerCall: 3, pollConcurrency: 1 });
    await p.pollReceipts(["a", "b", "c", "d", "e"]);
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for an empty list without calling the API", async () => {
    const { fetch, calls } = fakeFetch([]);
    const p = new Telecom23Provider({ apiKey: "k", fetch });
    await expect(p.pollReceipts([])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("throws on authentication, server and network failures so the sweep logs and retries later", async () => {
    const unauthorized = fakeFetch([
      { status: 401, body: { status: false, error_code: "UNAUTHORIZED" } },
    ]);
    await expect(
      new Telecom23Provider({ apiKey: "k", fetch: unauthorized.fetch }).pollReceipts(["a"]),
    ).rejects.toThrow("401 UNAUTHORIZED");
    const down = fakeFetch([new Error("ECONNRESET")]);
    await expect(
      new Telecom23Provider({ apiKey: "k", fetch: down.fetch }).pollReceipts(["a"]),
    ).rejects.toThrow("ECONNRESET");
  });
});

describe("isFinalDeliveryStatus", () => {
  it("knows which carrier statuses end a message", () => {
    for (const s of ["DELIVRD", "UNDELIV", "REJECTD", "EXPIRED", "UNKNOWN", "DELETED", "failed"]) {
      expect(isFinalDeliveryStatus(s), s).toBe(true);
    }
    for (const s of ["SENT", "ENROUTE", "ACCEPTD", "pending", "", "whatever"]) {
      expect(isFinalDeliveryStatus(s), s).toBe(false);
    }
  });
});

describe("Telecom23Provider sender ids and prices", () => {
  it("applies the carrier's sender id rule: 3 to 11 alphanumerics, not starting with a digit", () => {
    const p = new Telecom23Provider({ apiKey: "k" });
    expect(p.validateSenderId("Sendex", "ES")).toEqual({ ok: true });
    expect(p.validateSenderId("ABC12345678", "ES")).toEqual({ ok: true });
    expect(p.validateSenderId("AB", "ES").ok).toBe(false);
    expect(p.validateSenderId("1Sendex", "ES").ok).toBe(false);
    expect(p.validateSenderId("Send ex", "ES").ok).toBe(false);
    expect(p.validateSenderId("ABC123456789", "ES").ok).toBe(false);
  });

  it("prices from its map and null elsewhere", async () => {
    const p = new Telecom23Provider({ apiKey: "k", prices: { "23t-es:ES": 0.031 } });
    await expect(p.priceFor("23t-es", "ES")).resolves.toBe(0.031);
    await expect(p.priceFor("23t-es", "FR")).resolves.toBeNull();
  });

  it("derives a stable idempotency key from the message ids in any order", () => {
    const key = telecom23IdempotencyKey(["b", "a"]);
    expect(key).toBe(telecom23IdempotencyKey(["a", "b"]));
    expect(key).toMatch(/^[A-Za-z0-9_.:-]{1,128}$/);
    expect(key).not.toBe(telecom23IdempotencyKey(["a", "c"]));
  });
});
