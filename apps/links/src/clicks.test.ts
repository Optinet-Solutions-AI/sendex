import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClickRecord, type ClickRecord, forwardClickBatch, postClicks } from "./clicks.js";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const CLICK: ClickRecord = {
  shortCode: "abcdefgh",
  clickedAt: "2026-11-06T10:00:00.000Z",
  ip: "203.0.113.9",
  userAgent: IPHONE,
  country: "ES",
  device: "mobile",
  asn: "Vodafone Spain",
};

const TARGET = { workerUrl: "https://worker.example", secret: "s3cret" };

function stubFetch(status: number) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return new Response(null, { status });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildClickRecord", () => {
  const now = new Date("2026-11-06T10:00:00.000Z");

  it("reads the ip, user agent and Cloudflare geo from the request", () => {
    const req = Object.assign(
      new Request("https://lnk.example/abcdefgh", {
        headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": IPHONE },
      }),
      { cf: { country: "ES", asOrganization: "Vodafone Spain" } },
    );
    expect(buildClickRecord("abcdefgh", req, now)).toEqual(CLICK);
  });

  it("falls back to x-forwarded-for, then unknown, for the ip", () => {
    const forwarded = new Request("https://lnk.example/abcdefgh", {
      headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1", "user-agent": IPHONE },
    });
    expect(buildClickRecord("abcdefgh", forwarded, now).ip).toBe("198.51.100.7");
    const bare = new Request("https://lnk.example/abcdefgh");
    const record = buildClickRecord("abcdefgh", bare, now);
    expect(record).toEqual({
      shortCode: "abcdefgh",
      clickedAt: "2026-11-06T10:00:00.000Z",
      ip: "unknown",
      userAgent: "",
      device: "unknown",
    });
  });

  it("ignores non-string cf fields", () => {
    const req = Object.assign(new Request("https://lnk.example/abcdefgh"), {
      cf: { country: 42, asOrganization: null },
    });
    const record = buildClickRecord("abcdefgh", req, now);
    expect(record.country).toBeUndefined();
    expect(record.asn).toBeUndefined();
  });
});

describe("postClicks", () => {
  it("posts a batch to the worker with the secret and resolves on 2xx", async () => {
    const calls = stubFetch(202);
    await postClicks(TARGET, [CLICK]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://worker.example/internal/clicks");
    expect(calls[0]?.init?.method).toBe("POST");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("x-internal-secret")).toBe("s3cret");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ clicks: [CLICK] });
  });

  it("rejects on a non-2xx answer so the caller can retry", async () => {
    stubFetch(503);
    await expect(postClicks(TARGET, [CLICK])).rejects.toThrow(/503/);
  });

  it("does nothing for an empty batch", async () => {
    const calls = stubFetch(202);
    await postClicks(TARGET, []);
    expect(calls).toHaveLength(0);
  });
});

describe("forwardClickBatch (queue consumer)", () => {
  function fakeBatch(bodies: ClickRecord[]) {
    const acked: string[] = [];
    const retried: string[] = [];
    const batch = {
      queue: "sendex-clicks",
      messages: bodies.map((body, i) => ({
        id: String(i),
        timestamp: new Date(),
        body,
        attempts: 1,
        ack: () => acked.push(String(i)),
        retry: () => retried.push(String(i)),
      })),
      ackAll: () => acked.push("all"),
      retryAll: () => retried.push("all"),
    };
    return { acked, retried, batch: batch as unknown as MessageBatch<ClickRecord> };
  }

  it("forwards every message in one request and acks the batch", async () => {
    const calls = stubFetch(202);
    const { batch, acked, retried } = fakeBatch([CLICK, { ...CLICK, shortCode: "bcdefghj" }]);
    await forwardClickBatch(batch, TARGET);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.init?.body)) as { clicks: ClickRecord[] };
    expect(body.clicks.map((c) => c.shortCode)).toEqual(["abcdefgh", "bcdefghj"]);
    expect(acked).toEqual(["all"]);
    expect(retried).toEqual([]);
  });

  it("retries the whole batch when the worker rejects it", async () => {
    stubFetch(500);
    const { batch, acked, retried } = fakeBatch([CLICK]);
    await forwardClickBatch(batch, TARGET);
    expect(acked).toEqual([]);
    expect(retried).toEqual(["all"]);
  });
});
