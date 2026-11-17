import { describe, expect, it } from "vitest";
import { createShortIoShortener } from "./shortener.js";

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

/** A stand-in for `fetch` that answers from `respond` and remembers what it was asked. */
function fakeFetch(respond: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const DOMAINS = [
  { hostname: "cc.test", state: "configured" },
  { hostname: "aa.test", state: "configured" },
  { hostname: "pending.example", state: "not_configured" },
];

describe("createShortIoShortener", () => {
  it("lists the domains that are set up, with the key in the Authorization header", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({ body: DOMAINS }));
    const shortener = createShortIoShortener({ apiKey: "sk_test", fetch: fetchFn });
    expect(await shortener.domains()).toEqual(["cc.test", "aa.test"]);
    expect(calls[0]).toMatchObject({
      url: "https://api.short.io/api/domains",
      method: "GET",
      authorization: "sk_test",
    });
  });

  it("asks for the domains once and reuses the answer until it is five minutes old", async () => {
    let clock = 0;
    const { fetchFn, calls } = fakeFetch(() => ({ body: DOMAINS }));
    const shortener = createShortIoShortener({
      apiKey: "sk_test",
      fetch: fetchFn,
      now: () => clock,
    });
    await shortener.domains();
    clock = 4 * 60_000;
    await shortener.domains();
    expect(calls).toHaveLength(1);
    clock = 6 * 60_000;
    await shortener.domains();
    expect(calls).toHaveLength(2);
  });

  it("shortens a batch in one call and returns the short addresses in the order asked", async () => {
    const { fetchFn, calls } = fakeFetch((call) => {
      const links = (call.body as { links: Array<{ originalURL: string }> }).links;
      // Answered out of order on purpose: the match is on the address, not the position.
      return {
        body: [...links].reverse().map((l) => ({
          originalURL: l.originalURL,
          secureShortURL: `https://cc.test/${l.originalURL.slice(-1)}`,
          success: true,
        })),
      };
    });
    const shortener = createShortIoShortener({ apiKey: "sk_test", fetch: fetchFn });
    const urls = await shortener.shorten("cc.test", ["https://go.test/a", "https://go.test/b"]);
    expect(urls).toEqual(["https://cc.test/a", "https://cc.test/b"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.short.io/links/bulk",
      method: "POST",
      authorization: "sk_test",
      body: {
        domain: "cc.test",
        links: [{ originalURL: "https://go.test/a" }, { originalURL: "https://go.test/b" }],
      },
    });
  });

  it("gives null for an address the shortener did not make a link for", async () => {
    const { fetchFn } = fakeFetch(() => ({
      body: [
        { originalURL: "https://go.test/a", secureShortURL: "https://cc.test/a", success: true },
        { originalURL: "https://go.test/b", success: false, error: "Link limit reached" },
      ],
    }));
    const shortener = createShortIoShortener({ apiKey: "sk_test", fetch: fetchFn });
    expect(await shortener.shorten("cc.test", ["https://go.test/a", "https://go.test/b"])).toEqual([
      "https://cc.test/a",
      null,
    ]);
  });

  it("splits more than a thousand addresses over several calls", async () => {
    const { fetchFn, calls } = fakeFetch((call) => ({
      body: (call.body as { links: Array<{ originalURL: string }> }).links.map((l) => ({
        originalURL: l.originalURL,
        secureShortURL: l.originalURL.replace("https://go.test/", "https://cc.test/"),
        success: true,
      })),
    }));
    const shortener = createShortIoShortener({ apiKey: "sk_test", fetch: fetchFn });
    const targets = Array.from({ length: 1001 }, (_, i) => `https://go.test/${i}`);
    const urls = await shortener.shorten("cc.test", targets);
    expect(calls).toHaveLength(2);
    expect(urls[0]).toBe("https://cc.test/0");
    expect(urls[1000]).toBe("https://cc.test/1000");
  });

  it("makes no call for an empty batch", async () => {
    const { fetchFn, calls } = fakeFetch(() => ({ body: [] }));
    const shortener = createShortIoShortener({ apiKey: "sk_test", fetch: fetchFn });
    expect(await shortener.shorten("cc.test", [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("throws on a refused call, naming the status but never the key", async () => {
    const { fetchFn } = fakeFetch(() => ({ status: 402, body: { error: "Payment required" } }));
    const shortener = createShortIoShortener({ apiKey: "sk_secret_value", fetch: fetchFn });
    const failure = shortener.shorten("cc.test", ["https://go.test/a"]);
    await expect(failure).rejects.toThrow(/402/);
    await expect(failure).rejects.not.toThrow(/sk_secret_value/);
    await expect(shortener.domains()).rejects.toThrow(/402/);
  });
});
