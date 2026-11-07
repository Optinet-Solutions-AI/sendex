import { describe, expect, it } from "vitest";
import type { OutboundMessage } from "../provider.js";
import { CustomHttpProvider, fillTemplate } from "./custom-http-provider.js";

const msg = (id: string): OutboundMessage => ({
  id,
  to: "+34600000001",
  senderId: "Sendex",
  text: "hi there & bye",
  encoding: "GSM_7BIT",
  route: "custom",
  country: "ES",
});

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift();
    if (next === undefined) throw new Error("no response scripted");
    calls.push({ url: String(input), init: init ?? {} });
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const API = "https://api.provider.com/sms?from={{{from}}}&to={{{number}}}&text={{{text}}}";

describe("CustomHttpProvider", () => {
  it("fills the placeholders, URL-encoded, and posts a JSON body with basic auth and headers", async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { message_id: "abc" } }]);
    const provider = new CustomHttpProvider({
      name: "custom",
      apiUrl: API,
      username: "u",
      password: "p",
      headers: [{ name: "X-Key", value: "k" }],
      fetch,
    });
    const outcomes = await provider.send([msg("m1")]);
    expect(outcomes).toEqual([{ id: "m1", status: "accepted", providerMessageId: "abc" }]);
    const call = calls[0];
    expect(call?.url).toBe(
      "https://api.provider.com/sms?from=Sendex&to=34600000001&text=hi%20there%20%26%20bye",
    );
    expect(call?.init.method).toBe("POST");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
    expect(headers["X-Key"]).toBe("k");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      from: "Sendex",
      to: "34600000001",
      text: "hi there & bye",
    });
  });

  it("uses GET without a body when asked, and makes up an id when the gateway gives none", async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const provider = new CustomHttpProvider({
      name: "c",
      apiUrl: API,
      usePost: false,
      fetch,
      newId: () => "gen-1",
    });
    expect(await provider.send([msg("m1")])).toEqual([
      { id: "m1", status: "accepted", providerMessageId: "gen-1" },
    ]);
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("reports HTTP and network failures per message, retryable for 5xx and 429", async () => {
    const { fetch } = fakeFetch([
      { status: 400, body: { error: "bad" } },
      { status: 503 },
      new Error("ECONNREFUSED 1.2.3.4"),
    ]);
    const provider = new CustomHttpProvider({ name: "c", apiUrl: API, fetch });
    expect(await provider.send([msg("a"), msg("b"), msg("c")])).toEqual([
      { id: "a", status: "failed", reason: "HTTP_400", retryable: false },
      { id: "b", status: "failed", reason: "HTTP_503", retryable: true },
      { id: "c", status: "failed", reason: "NETWORK_ECONNREFUSED", retryable: true },
    ]);
  });

  it("parses generic receipts and ignores intermediate states", () => {
    const provider = new CustomHttpProvider({ name: "c", apiUrl: API });
    expect(
      provider.parseDeliveryReceipt({ id: "x", status: "DELIVRD", operator: "Orange" }),
    ).toMatchObject({
      providerMessageId: "x",
      status: "delivered",
      operator: "Orange",
    });
    expect(
      provider.parseDeliveryReceipt({ message_id: "y", status: "failed", error: "ABSENT" }),
    ).toMatchObject({
      providerMessageId: "y",
      status: "failed",
      errorCode: "ABSENT",
    });
    expect(provider.parseDeliveryReceipt({ id: "z", status: "enroute" })).toBeNull();
    expect(provider.parseDeliveryReceipt("nope")).toBeNull();
  });

  it("probes the origin and reports the latency", async () => {
    const { fetch, calls } = fakeFetch([{ status: 405 }, { status: 200 }]);
    const provider = new CustomHttpProvider({ name: "c", apiUrl: API, fetch });
    const probe = await provider.probe();
    expect(probe.status).toBe(200);
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    expect(calls.map((c) => c.init.method)).toEqual(["HEAD", "GET"]);
    const down = new CustomHttpProvider({
      name: "c",
      apiUrl: API,
      fetch: fakeFetch([new Error("ENOTFOUND")]).fetch,
    });
    await expect(down.probe()).rejects.toThrow(/cannot reach https:\/\/api.provider.com/);
  });

  it("fills templates without encoding when asked", () => {
    expect(
      fillTemplate(
        "{{{from}}}:{{{number}}}:{{{text}}}",
        { from: "A", number: "1", text: "x y" },
        false,
      ),
    ).toBe("A:1:x y");
  });
});
