import { SHORT_CODE_ALPHABET } from "@sendex/core";
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

/** The links of the n-th bulk call; fails the test when that call was never made. */
function linksOf(calls: Call[], n: number): Array<{ originalURL: string; path?: string }> {
  const call = calls[n];
  if (!call) throw new Error(`call ${n} was not made`);
  return (call.body as { links: Array<{ originalURL: string; path?: string }> }).links;
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
    const endings = ["p1x", "p2x"];
    const shortener = createShortIoShortener({
      apiKey: "sk_test",
      fetch: fetchFn,
      newPath: () => endings.shift() ?? "zzz",
    });
    const urls = await shortener.shorten("cc.test", ["https://go.test/a", "https://go.test/b"]);
    expect(urls).toEqual(["https://cc.test/a", "https://cc.test/b"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.short.io/links/bulk",
      method: "POST",
      authorization: "sk_test",
      body: {
        domain: "cc.test",
        links: [
          { originalURL: "https://go.test/a", path: "p1x" },
          { originalURL: "https://go.test/b", path: "p2x" },
        ],
      },
    });
  });

  it("asks for its own three-character ending on every link, never the same one twice (D4-24)", async () => {
    const { fetchFn, calls } = fakeFetch((call) => ({
      body: (call.body as { links: Array<{ originalURL: string; path: string }> }).links.map(
        (l) => ({
          originalURL: l.originalURL,
          secureShortURL: `https://cc.test/${l.path}`,
          success: true,
        }),
      ),
    }));
    const shortener = createShortIoShortener({ apiKey: "sk_test", fetch: fetchFn });
    const targets = Array.from({ length: 200 }, (_, i) => `https://go.test/${i}`);
    const urls = await shortener.shorten("cc.test", targets);
    const paths = linksOf(calls, 0).map((l) => l.path);
    const threeFromTheAlphabet = new RegExp(`^[${SHORT_CODE_ALPHABET}]{3}$`);
    for (const path of paths) expect(path).toMatch(threeFromTheAlphabet);
    expect(new Set(paths).size).toBe(200);
    expect(urls[0]).toBe(`https://cc.test/${paths[0]}`);
  });

  it("does not send the same ending twice in one call when the generator repeats itself", async () => {
    const { fetchFn, calls } = fakeFetch((call) => ({
      body: (call.body as { links: Array<{ originalURL: string; path: string }> }).links.map(
        (l) => ({ originalURL: l.originalURL, secureShortURL: `https://cc.test/${l.path}` }),
      ),
    }));
    const endings = ["aaa", "aaa", "bbb"];
    const shortener = createShortIoShortener({
      apiKey: "sk_test",
      fetch: fetchFn,
      newPath: () => endings.shift() ?? "zzz",
    });
    await shortener.shorten("cc.test", ["https://go.test/a", "https://go.test/b"]);
    expect(linksOf(calls, 0)).toEqual([
      { originalURL: "https://go.test/a", path: "aaa" },
      { originalURL: "https://go.test/b", path: "bbb" },
    ]);
  });

  it("asks again, without an ending, for an address whose ending was already taken", async () => {
    const { fetchFn, calls } = fakeFetch((call) => {
      const links = (call.body as { links: Array<{ originalURL: string; path?: string }> }).links;
      return {
        body: links.map((l) =>
          // What Short.io answers for an ending in use: no address, just the refusal.
          l.path === "p2x"
            ? { success: false, error: "Link already exists", status: 409 }
            : {
                originalURL: l.originalURL,
                secureShortURL: `https://cc.test/${l.path ?? "AbCdEf"}`,
                success: true,
              },
        ),
      };
    });
    const endings = ["p1x", "p2x"];
    const shortener = createShortIoShortener({
      apiKey: "sk_test",
      fetch: fetchFn,
      newPath: () => endings.shift() ?? "zzz",
    });
    const urls = await shortener.shorten("cc.test", ["https://go.test/a", "https://go.test/b"]);
    expect(urls).toEqual(["https://cc.test/p1x", "https://cc.test/AbCdEf"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toEqual({
      domain: "cc.test",
      links: [{ originalURL: "https://go.test/b" }],
    });
  });

  it("asks again for a single address whose ending was taken", async () => {
    const { fetchFn, calls } = fakeFetch((call) => {
      const [link] = (call.body as { links: Array<{ originalURL: string; path?: string }> }).links;
      return {
        body: [
          link?.path === undefined
            ? { originalURL: link?.originalURL, secureShortURL: "https://cc.test/AbCdEf" }
            : { success: false, error: "Link already exists", status: 409 },
        ],
      };
    });
    const shortener = createShortIoShortener({ apiKey: "sk_test", fetch: fetchFn });
    expect(await shortener.shorten("cc.test", ["https://go.test/a"])).toEqual([
      "https://cc.test/AbCdEf",
    ]);
    expect(calls).toHaveLength(2);
  });

  it("keeps the links it has when the second ask is refused", async () => {
    const { fetchFn } = fakeFetch((call) => {
      const links = (call.body as { links: Array<{ originalURL: string; path?: string }> }).links;
      if (links.every((l) => l.path === undefined)) return { status: 500, body: {} };
      return {
        body: [
          { originalURL: "https://go.test/a", secureShortURL: "https://cc.test/p1x" },
          { success: false, error: "Link already exists", status: 409 },
        ],
      };
    });
    const shortener = createShortIoShortener({ apiKey: "sk_test", fetch: fetchFn });
    expect(await shortener.shorten("cc.test", ["https://go.test/a", "https://go.test/b"])).toEqual([
      "https://cc.test/p1x",
      null,
    ]);
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
