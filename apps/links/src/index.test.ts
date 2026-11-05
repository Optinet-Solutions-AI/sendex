import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClickRecord } from "./clicks.js";
import { app, type Bindings, LINK_TTL_SECONDS } from "./index.js";

const CODE = "abcdefgh";
const PAYLOAD = {
  url: "https://dest.example/?d=dyn-1",
  organisationId: "org-1",
  messageId: "msg-1",
  campaignId: "cmp-1",
  lapId: "lap-1",
};
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const CF = { country: "ES", asOrganization: "Vodafone Spain" };

function fakeKv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  for (const [key, value] of Object.entries(initial)) store.set(key, JSON.stringify(value));
  const puts: Array<{ key: string; value: string; options: unknown }> = [];
  const gets: string[] = [];
  const kv = {
    async get(key: string, type?: string) {
      gets.push(key);
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string, options?: unknown) {
      store.set(key, value);
      puts.push({ key, value, options });
    },
  };
  return { store, puts, gets, kv: kv as unknown as KVNamespace };
}

/** Records a message only on a later tick, so a response that waited for it would see it. */
function fakeQueue() {
  const sent: ClickRecord[] = [];
  const queue = {
    async send(message: ClickRecord) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sent.push(message);
    },
  };
  return { sent, queue: queue as unknown as Queue<ClickRecord> };
}

function fakeCtx() {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise);
    },
    passThroughOnException() {},
  };
  return { ctx: ctx as unknown as ExecutionContext, flush: () => Promise.all(promises) };
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  cf?: Record<string, string>;
}

function request(path: string, options: RequestOptions = {}): Request {
  const req = new Request(`https://lnk.example${path}`, {
    method: options.method ?? "GET",
    headers: {
      "cf-connecting-ip": "203.0.113.9",
      "user-agent": IPHONE,
      ...options.headers,
    },
    redirect: "manual",
  });
  return Object.assign(req, { cf: options.cf ?? CF });
}

function env(overrides: Partial<Bindings> = {}): Bindings {
  return {
    SENDEX_VERSION: "test",
    WORKER_URL: "https://worker.example",
    INTERNAL_API_SECRET: "s3cret",
    ...overrides,
  };
}

type FetchCall = { url: string; init: RequestInit | undefined };

function stubFetch(respond: (url: string, init: RequestInit | undefined) => Response) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    return respond(url, init);
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /health", () => {
  it("answers with the version", async () => {
    const res = await app.request("/health", {}, env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "test" });
  });
});

describe("GET /:code with a KV hit", () => {
  it("redirects and queues the click without blocking the response", async () => {
    const { kv } = fakeKv({ [`code:${CODE}`]: PAYLOAD });
    const { sent, queue } = fakeQueue();
    const calls = stubFetch(() => new Response(null, { status: 500 }));
    const { ctx, flush } = fakeCtx();
    const before = Date.now();

    const res = await app.request(
      request(`/${CODE}`),
      undefined,
      env({ LINKS: kv, CLICKS: queue }),
      ctx,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(PAYLOAD.url);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(sent).toHaveLength(0);
    await flush();
    expect(sent).toHaveLength(1);
    const click = sent[0];
    expect(click).toMatchObject({
      shortCode: CODE,
      ip: "203.0.113.9",
      userAgent: IPHONE,
      country: "ES",
      device: "mobile",
      asn: "Vodafone Spain",
    });
    expect(Date.parse(click?.clickedAt ?? "")).toBeGreaterThanOrEqual(before);
    expect(calls).toHaveLength(0);
  });

  it("posts the click to the worker when there is no queue binding", async () => {
    const { kv } = fakeKv({ [`code:${CODE}`]: PAYLOAD });
    const calls = stubFetch(() => new Response(null, { status: 202 }));
    const { ctx, flush } = fakeCtx();

    const res = await app.request(request(`/${CODE}`), undefined, env({ LINKS: kv }), ctx);
    expect(res.status).toBe(302);
    await flush();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://worker.example/internal/clicks");
    expect(call?.init?.method).toBe("POST");
    expect(new Headers(call?.init?.headers).get("x-internal-secret")).toBe("s3cret");
    expect(new Headers(call?.init?.headers).get("content-type")).toBe("application/json");
    const body = JSON.parse(String(call?.init?.body)) as { clicks: ClickRecord[] };
    expect(body.clicks).toHaveLength(1);
    expect(body.clicks[0]).toMatchObject({ shortCode: CODE, device: "mobile" });
  });

  it("omits country and asn when Cloudflare gives none", async () => {
    const { kv } = fakeKv({ [`code:${CODE}`]: PAYLOAD });
    const { sent, queue } = fakeQueue();
    const { ctx, flush } = fakeCtx();

    await app.request(
      request(`/${CODE}`, { cf: {} }),
      undefined,
      env({ LINKS: kv, CLICKS: queue }),
      ctx,
    );
    await flush();

    expect(sent[0]).toEqual({
      shortCode: CODE,
      clickedAt: expect.any(String),
      ip: "203.0.113.9",
      userAgent: IPHONE,
      device: "mobile",
    });
  });

  it("still redirects when recording the click fails", async () => {
    const { kv } = fakeKv({ [`code:${CODE}`]: PAYLOAD });
    const queue = {
      async send() {
        throw new Error("queue down");
      },
    } as unknown as Queue<ClickRecord>;
    const { ctx, flush } = fakeCtx();

    const res = await app.request(
      request(`/${CODE}`),
      undefined,
      env({ LINKS: kv, CLICKS: queue }),
      ctx,
    );
    expect(res.status).toBe(302);
    await expect(flush()).resolves.toBeDefined();
  });
});

describe("GET /:code with a KV miss", () => {
  it("resolves through the worker, caches for 30 days and redirects", async () => {
    const { kv, puts, store } = fakeKv();
    const { sent, queue } = fakeQueue();
    const calls = stubFetch((url) =>
      url.endsWith(`/internal/links/${CODE}`)
        ? Response.json(PAYLOAD)
        : new Response(null, { status: 404 }),
    );
    const { ctx, flush } = fakeCtx();

    const res = await app.request(
      request(`/${CODE}`),
      undefined,
      env({ LINKS: kv, CLICKS: queue }),
      ctx,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(PAYLOAD.url);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://worker.example/internal/links/${CODE}`);
    expect(new Headers(calls[0]?.init?.headers).get("x-internal-secret")).toBe("s3cret");
    await flush();
    expect(puts).toEqual([
      {
        key: `code:${CODE}`,
        value: JSON.stringify(PAYLOAD),
        options: { expirationTtl: LINK_TTL_SECONDS },
      },
    ]);
    expect(LINK_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(JSON.parse(store.get(`code:${CODE}`) ?? "null")).toEqual(PAYLOAD);
    expect(sent).toHaveLength(1);
  });

  it("works without a KV binding at all", async () => {
    const { queue } = fakeQueue();
    stubFetch(() => Response.json(PAYLOAD));
    const { ctx } = fakeCtx();
    const res = await app.request(request(`/${CODE}`), undefined, env({ CLICKS: queue }), ctx);
    expect(res.status).toBe(302);
  });

  it("returns 404 when the worker does not know the code", async () => {
    const { kv, puts } = fakeKv();
    const { sent, queue } = fakeQueue();
    stubFetch(() => new Response("Not found", { status: 404 }));
    const { ctx, flush } = fakeCtx();

    const res = await app.request(
      request(`/${CODE}`),
      undefined,
      env({ LINKS: kv, CLICKS: queue }),
      ctx,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/plain");
    await flush();
    expect(puts).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("returns 404 when the worker answers with a malformed payload", async () => {
    const { kv, puts } = fakeKv();
    stubFetch(() => Response.json({ url: 42 }));
    const { ctx, flush } = fakeCtx();
    const res = await app.request(request(`/${CODE}`), undefined, env({ LINKS: kv }), ctx);
    expect(res.status).toBe(404);
    await flush();
    expect(puts).toHaveLength(0);
  });

  it("returns 404 when the worker is unreachable", async () => {
    const { kv } = fakeKv();
    stubFetch(() => {
      throw new Error("connect ECONNREFUSED");
    });
    const { ctx } = fakeCtx();
    const res = await app.request(request(`/${CODE}`), undefined, env({ LINKS: kv }), ctx);
    expect(res.status).toBe(404);
  });

  it("returns 404 without calling the worker when WORKER_URL is unset", async () => {
    const { kv } = fakeKv();
    const calls = stubFetch(() => Response.json(PAYLOAD));
    const { ctx } = fakeCtx();
    const res = await app.request(
      request(`/${CODE}`),
      undefined,
      env({ LINKS: kv, WORKER_URL: "" }),
      ctx,
    );
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /:code with an invalid code", () => {
  it.each(["/abc", "/abcdefg0", "/ABCDEFGHJ", "/abcdefg-", "/health2"])(
    "returns 404 for %s without touching KV or the worker",
    async (path) => {
      const { kv, gets } = fakeKv({ [`code:${CODE}`]: PAYLOAD });
      const calls = stubFetch(() => Response.json(PAYLOAD));
      const { ctx } = fakeCtx();
      const res = await app.request(request(path), undefined, env({ LINKS: kv }), ctx);
      expect(res.status).toBe(404);
      expect(gets).toHaveLength(0);
      expect(calls).toHaveLength(0);
    },
  );
});

describe("redirects that are not recorded", () => {
  it("HEAD /:code redirects without a body and records nothing", async () => {
    const { kv } = fakeKv({ [`code:${CODE}`]: PAYLOAD });
    const { sent, queue } = fakeQueue();
    const calls = stubFetch(() => new Response(null, { status: 202 }));
    const { ctx, flush } = fakeCtx();

    const res = await app.request(
      request(`/${CODE}`, { method: "HEAD" }),
      undefined,
      env({ LINKS: kv, CLICKS: queue }),
      ctx,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(PAYLOAD.url);
    expect(await res.text()).toBe("");
    await flush();
    expect(sent).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("a bot user agent is redirected but not recorded", async () => {
    const { kv } = fakeKv({ [`code:${CODE}`]: PAYLOAD });
    const { sent, queue } = fakeQueue();
    const { ctx, flush } = fakeCtx();

    const res = await app.request(
      request(`/${CODE}`, {
        headers: {
          "user-agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        },
      }),
      undefined,
      env({ LINKS: kv, CLICKS: queue }),
      ctx,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(PAYLOAD.url);
    await flush();
    expect(sent).toHaveLength(0);
  });
});
