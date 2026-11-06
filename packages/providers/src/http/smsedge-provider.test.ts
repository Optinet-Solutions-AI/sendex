import { describe, expect, it } from "vitest";
import type { OutboundMessage } from "../provider.js";
import { SMSEDGE_BASE_URL, SmsEdgeProvider, smsEdgeRouteKey } from "./smsedge-provider.js";

const msg = (id: string, to = "+34600000000", route = "137"): OutboundMessage => ({
  id,
  to,
  senderId: "Sendex",
  text: `hello ${id} https://sendex-links.example/abc`,
  encoding: "GSM_7BIT",
  route,
  country: "ES",
});

interface Call {
  url: URL;
  init: RequestInit;
}

/** A fetch stub that records calls and answers with the given responses in order. */
function fakeFetch(responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  const responsesLeft = responses;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift();
    if (next === undefined) throw new Error("no response scripted");
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, responsesLeft };
}

/** SMS Edge wraps every answer in a one-element array. */
const wrap = (payload: Record<string, unknown>) => [
  {
    success: true,
    errors: [],
    response: { code: 200, description: "OK", date: "2026-11-06 16:00:00" },
    ...payload,
  },
];

const routesBody = wrap({
  data: [
    { id: "108", name: "Route 137", country_id: "203", country_name: "Spain", price: 0.0276 },
    {
      id: "108",
      name: "Route 137",
      country_id: "227",
      country_name: "United Kingdom",
      price: 0.0371,
    },
    { id: "109", name: "Route 136", country_id: "203", country_name: "Spain", price: 0.028 },
  ],
});

const sentBody = (id: number) => wrap({ data: { id, status: "sent", parts: 1 } });

describe("SmsEdgeProvider.send", () => {
  it("resolves our route name to the SMS Edge route id once, then posts one send-single per message", async () => {
    const { fetch, calls, responsesLeft } = fakeFetch([
      { status: 200, body: routesBody },
      { status: 200, body: sentBody(19591) },
      { status: 200, body: sentBody(19592) },
    ]);
    const p = new SmsEdgeProvider({ apiKey: "key123", fetch, concurrency: 1 });
    const out = await p.send([msg("a"), msg("b", "+34600000001")]);

    expect(out).toEqual([
      { id: "a", status: "accepted", providerMessageId: "19591" },
      { id: "b", status: "accepted", providerMessageId: "19592" },
    ]);
    expect(calls).toHaveLength(3);
    const routes = calls[0] as Call;
    expect(routes.url.origin + routes.url.pathname).toBe(`${SMSEDGE_BASE_URL}/v1/routes/getall/`);
    expect(routes.url.searchParams.get("api_key")).toBe("key123");

    const first = calls[1] as Call;
    expect(first.init.method).toBe("POST");
    expect(first.url.origin + first.url.pathname).toBe(`${SMSEDGE_BASE_URL}/v1/sms/send-single/`);
    expect(Object.fromEntries(first.url.searchParams)).toEqual({
      api_key: "key123",
      from: "Sendex",
      to: "34600000000",
      text: "hello a https://sendex-links.example/abc",
      reference: "a",
      shorten_url: "0",
      preferred_route_id: "108",
    });
    expect((calls[2] as Call).url.searchParams.get("to")).toBe("34600000001");

    // The route map is cached: a second batch does not fetch routes again.
    responsesLeft.push({ status: 200, body: sentBody(19593) });
    await p.send([msg("c", "+34600000002")]);
    expect(calls).toHaveLength(4);
    expect((calls[3] as Call).url.searchParams.get("preferred_route_id")).toBe("108");
  });

  it("uses a given route map without fetching routes", async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: sentBody(1) }]);
    const p = new SmsEdgeProvider({ apiKey: "k", fetch, routeIds: { "Route 137": 108 } });
    await p.send([msg("c")]);
    expect(calls).toHaveLength(1);
    expect((calls[0] as Call).url.searchParams.get("preferred_route_id")).toBe("108");
  });

  it("accepts route names with or without the 'Route' prefix", async () => {
    const { fetch, calls } = fakeFetch([
      { status: 200, body: routesBody },
      { status: 200, body: sentBody(1) },
      { status: 200, body: sentBody(2) },
    ]);
    const p = new SmsEdgeProvider({ apiKey: "k", fetch, concurrency: 1 });
    const out = await p.send([
      msg("a", "+34600000000", "Route 136"),
      msg("b", "+34600000001", "136"),
    ]);
    expect(out.map((o) => o.status)).toEqual(["accepted", "accepted"]);
    expect(calls.slice(1).map((c) => c.url.searchParams.get("preferred_route_id"))).toEqual([
      "109",
      "109",
    ]);
  });

  it("fails a message on an unknown route without calling send-single", async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: routesBody }]);
    const p = new SmsEdgeProvider({ apiKey: "k", fetch });
    await expect(p.send([msg("a", "+34600000000", "999")])).resolves.toEqual([
      { id: "a", status: "failed", reason: "UNKNOWN_ROUTE", retryable: false },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("retries the batch later when the route list cannot be fetched", async () => {
    const { fetch } = fakeFetch([new Error("ECONNRESET")]);
    const p = new SmsEdgeProvider({ apiKey: "k", fetch });
    await expect(p.send([msg("a")])).resolves.toEqual([
      { id: "a", status: "failed", reason: "ROUTES_UNAVAILABLE", retryable: true },
    ]);
  });

  it("maps API refusals to final failures and throttling, outages and network errors to retries", async () => {
    const refused = wrap({ success: false, errors: ["Insufficient balance"], data: null });
    const { fetch } = fakeFetch([
      { status: 200, body: refused },
      { status: 429, body: wrap({ success: false, errors: ["Too many requests"] }) },
      { status: 503, body: "<html>down</html>" },
      new Error("ETIMEDOUT"),
    ]);
    const p = new SmsEdgeProvider({ apiKey: "k", fetch, routeIds: { "137": 108 }, concurrency: 1 });
    const out = await p.send([
      msg("a"),
      msg("b", "+34600000001"),
      msg("c", "+34600000002"),
      msg("d", "+34600000003"),
    ]);
    expect(out).toEqual([
      { id: "a", status: "failed", reason: "INSUFFICIENT_BALANCE", retryable: false },
      { id: "b", status: "failed", reason: "HTTP_429_TOO_MANY_REQUESTS", retryable: true },
      { id: "c", status: "failed", reason: "HTTP_503", retryable: true },
      { id: "d", status: "failed", reason: "NETWORK_ETIMEDOUT", retryable: true },
    ]);
  });

  it("treats a success answer without an id as a retryable failure", async () => {
    const { fetch } = fakeFetch([{ status: 200, body: wrap({ data: { status: "sent" } }) }]);
    const p = new SmsEdgeProvider({ apiKey: "k", fetch, routeIds: { "137": 108 } });
    await expect(p.send([msg("a")])).resolves.toEqual([
      { id: "a", status: "failed", reason: "NO_MESSAGE_ID", retryable: true },
    ]);
  });
});

describe("SmsEdgeProvider.pollReceipts", () => {
  const row = (
    id: number,
    dlr: string | null,
    status = "sent",
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    created: "2026-11-06 16:00:00",
    reference: `ref-${id}`,
    status,
    dlr_status: dlr,
    ...extra,
  });

  it("asks /v1/sms/get/ in chunks and returns receipts only for final states", async () => {
    const { fetch, calls } = fakeFetch([
      {
        status: 200,
        body: wrap({
          data: [
            row(1, "DELIVERED"),
            row(2, "QUEUED"),
            row(3, "UNDELIVERED"),
            row(4, null, "failed"),
          ],
          errors: ["SMS with specified id [5] was not found"],
        }),
      },
      { status: 200, body: wrap({ data: [row(6, "EXPIRED")] }) },
    ]);
    const p = new SmsEdgeProvider({ apiKey: "k", fetch, pollChunk: 5 });
    const before = Date.now();
    const out = await p.pollReceipts(["1", "2", "3", "4", "5", "6"]);
    expect(out.map(({ at, ...r }) => r)).toEqual([
      { providerMessageId: "1", status: "delivered" },
      { providerMessageId: "3", status: "failed", errorCode: "UNDELIVERED" },
      { providerMessageId: "4", status: "failed", errorCode: "FAILED" },
      { providerMessageId: "6", status: "expired", errorCode: "EXPIRED" },
    ]);
    for (const r of out) expect(r.at.getTime()).toBeGreaterThanOrEqual(before);
    expect(calls.map((c) => c.url.searchParams.get("ids"))).toEqual(["1,2,3,4,5", "6"]);
    expect((calls[0] as Call).url.pathname).toBe("/v1/sms/get/");
    expect((calls[0] as Call).url.searchParams.get("api_key")).toBe("k");
  });

  it("returns nothing for an empty list and throws on authentication or network failures", async () => {
    const none = fakeFetch([]);
    await expect(
      new SmsEdgeProvider({ apiKey: "k", fetch: none.fetch }).pollReceipts([]),
    ).resolves.toEqual([]);
    expect(none.calls).toHaveLength(0);

    const bad = fakeFetch([
      { status: 200, body: wrap({ success: false, errors: ["Invalid API key"], data: [] }) },
    ]);
    await expect(
      new SmsEdgeProvider({ apiKey: "k", fetch: bad.fetch }).pollReceipts(["1"]),
    ).rejects.toThrow("Invalid API key");

    const down = fakeFetch([new Error("ECONNRESET")]);
    await expect(
      new SmsEdgeProvider({ apiKey: "k", fetch: down.fetch }).pollReceipts(["1"]),
    ).rejects.toThrow("ECONNRESET");
  });
});

describe("SmsEdgeProvider receipts, sender ids, prices and routes", () => {
  const p = new SmsEdgeProvider({ apiKey: "k", prices: { "137:ES": 0.0276 } });

  it("parses a message row the way the poll does", () => {
    expect(p.parseDeliveryReceipt({ id: 7, dlr_status: "DELIVERED" })).toMatchObject({
      providerMessageId: "7",
      status: "delivered",
    });
    expect(p.parseDeliveryReceipt({ id: "8", dlr_status: "REJECTED" })).toMatchObject({
      status: "failed",
      errorCode: "REJECTED",
    });
    expect(p.parseDeliveryReceipt({ id: 9, dlr_status: "QUEUED" })).toBeNull();
    expect(p.parseDeliveryReceipt({ dlr_status: "DELIVERED" })).toBeNull();
    expect(p.parseDeliveryReceipt("DELIVERED")).toBeNull();
  });

  it("allows up to 11 letters or digits as sender id", () => {
    expect(p.validateSenderId("Sendex", "ES")).toEqual({ ok: true });
    expect(p.validateSenderId("12345678901", "ES")).toEqual({ ok: true });
    expect(p.validateSenderId("Send ex", "ES").ok).toBe(false);
    expect(p.validateSenderId("", "ES").ok).toBe(false);
    expect(p.validateSenderId("ABCDEFGHIJKL", "ES").ok).toBe(false);
  });

  it("prices from its map and null elsewhere", async () => {
    await expect(p.priceFor("137", "ES")).resolves.toBe(0.0276);
    await expect(p.priceFor("137", "FR")).resolves.toBeNull();
  });

  it("normalises route names into one key", () => {
    expect(smsEdgeRouteKey("Route 137")).toBe("137");
    expect(smsEdgeRouteKey("137")).toBe("137");
    expect(smsEdgeRouteKey(" route 137 ")).toBe("137");
  });

  it("lists the account's routes with per-country prices", async () => {
    const { fetch } = fakeFetch([{ status: 200, body: routesBody }]);
    const q = new SmsEdgeProvider({ apiKey: "k", fetch });
    await expect(q.listRoutes()).resolves.toEqual([
      { id: 108, name: "Route 137", countryName: "Spain", price: 0.0276 },
      { id: 108, name: "Route 137", countryName: "United Kingdom", price: 0.0371 },
      { id: 109, name: "Route 136", countryName: "Spain", price: 0.028 },
    ]);
  });
});
