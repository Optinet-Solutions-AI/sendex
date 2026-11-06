/**
 * `SmsEdgeProvider`: the Provider implementation for SMS Edge's API
 * (https://developers.smsedge.io), which backs the `platform` routes (route names such as
 * `137` or `375` are SMS Edge routes). The API is older and simpler than a carrier's:
 *
 * - every call authenticates with an `api_key` query parameter;
 * - there is no multi-recipient endpoint for our own lists, so a batch is one
 *   `POST /v1/sms/send-single/` per message (`reference` = our message id, which SMS Edge
 *   uses to refuse a double submission; `shorten_url=0` keeps our tracked link intact;
 *   `preferred_route_id` pins the route);
 * - there is no SMS delivery webhook, so delivery is read by polling `GET /v1/sms/get/?ids=`
 *   through {@link SmsEdgeProvider.pollReceipts} (the receipt poll of D2-23);
 * - every answer is wrapped in a one-element array.
 *
 * Route ids: SMS Edge names routes `Route 137` with a numeric id (`108`) that differs from
 * the name; our route rows carry the name (`137`). The map name -> id comes from
 * `GET /v1/routes/getall/` the first time it is needed (or from the `routeIds` option).
 */

import type { DeliveryReceipt, OutboundMessage, Provider, SubmitOutcome } from "../provider.js";

export const SMSEDGE_BASE_URL = "https://api.smsedge.com";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_CHUNK = 100;

/** SMS Edge's rule: "11 characters max". Letters and digits only; numeric senders allowed. */
const SENDER_ID_RE = /^[A-Za-z0-9]{1,11}$/;

export interface SmsEdgeProviderOptions {
  /** Registry name. Default `platform`. */
  name?: string;
  apiKey: string;
  /** Default {@link SMSEDGE_BASE_URL}. */
  baseUrl?: string;
  /** Injected for tests. Default `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Parallel `send-single` calls. Default 4. */
  concurrency?: number;
  /** Per-request timeout. Default 15 s. */
  timeoutMs?: number;
  /** Price per SMS part in EUR keyed by `${route}:${country}`; the worker uses `route_prices`. */
  prices?: Record<string, number>;
  /** Our route name (`137`) -> SMS Edge route id (`108`). Fetched when absent. */
  routeIds?: Record<string, number>;
  /** Ids per `GET /v1/sms/get/` call. Default 100. */
  pollChunk?: number;
}

export interface SmsEdgeRoute {
  id: number;
  name: string;
  countryName: string;
  price: number;
}

/** `Route 137`, `137` and ` route 137 ` all key the same route. */
export function smsEdgeRouteKey(name: string): string {
  return name.trim().replace(/^route\s+/i, "");
}

/** Delivery states that end a message; everything else (`QUEUED`, `SENT`, null) is pending. */
const FINAL_DLR: Record<string, DeliveryReceipt["status"]> = {
  DELIVERED: "delivered",
  DELIVRD: "delivered",
  EXPIRED: "expired",
  UNDELIVERED: "failed",
  UNDELIV: "failed",
  REJECTED: "failed",
  REJECTD: "failed",
  FAILED: "failed",
  DELETED: "failed",
};

interface Envelope {
  success?: unknown;
  data?: unknown;
  errors?: unknown;
}

/** SMS Edge answers `[ { success, data, errors, ... } ]`; tolerate the bare object too. */
function unwrap(body: unknown): Envelope | null {
  const inner = Array.isArray(body) ? body[0] : body;
  return inner !== null && typeof inner === "object" ? (inner as Envelope) : null;
}

function firstError(envelope: Envelope | null): string | null {
  const errors = envelope?.errors;
  if (!Array.isArray(errors)) return null;
  const first = errors.find((e) => typeof e === "string" && e !== "");
  return typeof first === "string" ? first : null;
}

/** `Insufficient balance` -> `INSUFFICIENT_BALANCE`. */
function slug(text: string): string {
  return (
    text
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "ERROR"
  );
}

function retryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export class SmsEdgeProvider implements Provider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly prices: Record<string, number>;
  private readonly pollChunk: number;
  private routeIds: Map<string, number> | null;

  constructor(opts: SmsEdgeProviderOptions) {
    this.name = opts.name ?? "platform";
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? SMSEDGE_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.prices = opts.prices ?? {};
    this.pollChunk = Math.max(1, opts.pollChunk ?? DEFAULT_POLL_CHUNK);
    this.routeIds = opts.routeIds
      ? new Map(Object.entries(opts.routeIds).map(([k, v]) => [smsEdgeRouteKey(k), v]))
      : null;
  }

  async send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]> {
    if (batch.length === 0) return [];
    let routeIds: Map<string, number>;
    try {
      routeIds = await this.resolveRouteIds();
    } catch {
      return batch.map((m) => ({
        id: m.id,
        status: "failed",
        reason: "ROUTES_UNAVAILABLE",
        retryable: true,
      }));
    }
    return mapLimit(batch, this.concurrency, async (m) => {
      const routeId = routeIds.get(smsEdgeRouteKey(m.route));
      if (routeId === undefined) {
        return { id: m.id, status: "failed", reason: "UNKNOWN_ROUTE", retryable: false };
      }
      return this.sendOne(m, routeId);
    });
  }

  private async sendOne(m: OutboundMessage, routeId: number): Promise<SubmitOutcome> {
    const fail = (reason: string, retryable: boolean): SubmitOutcome => ({
      id: m.id,
      status: "failed",
      reason,
      retryable,
    });
    const url = this.url("/v1/sms/send-single/", {
      from: m.senderId,
      to: m.to.replace(/^\+/, ""),
      text: m.text,
      reference: m.id,
      shorten_url: "0",
      preferred_route_id: String(routeId),
    });
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return fail(`NETWORK_${networkCode(err)}`, true);
    }
    const body = await readJson(response);
    const envelope = unwrap(body);
    if (!response.ok) {
      const detail = firstError(envelope);
      const reason = detail ? `HTTP_${response.status}_${slug(detail)}` : `HTTP_${response.status}`;
      return fail(reason, retryableHttpStatus(response.status));
    }
    if (envelope?.success !== true) {
      return fail(slug(firstError(envelope) ?? "REFUSED"), false);
    }
    const data = envelope.data;
    const id =
      data !== null && typeof data === "object" ? (data as { id?: unknown }).id : undefined;
    if (typeof id !== "number" && !(typeof id === "string" && id !== "")) {
      return fail("NO_MESSAGE_ID", true);
    }
    return { id: m.id, status: "accepted", providerMessageId: String(id) };
  }

  /**
   * The receipt poll (D2-23): `GET /v1/sms/get/?ids=…` in chunks. SMS Edge has no SMS
   * delivery webhook, so this is the only way delivery reaches us. Ids SMS Edge does not know
   * come back in `errors` and are left out. Throws on an API or transport failure.
   */
  async pollReceipts(providerMessageIds: readonly string[]): Promise<DeliveryReceipt[]> {
    const receipts: DeliveryReceipt[] = [];
    for (let i = 0; i < providerMessageIds.length; i += this.pollChunk) {
      const chunk = providerMessageIds.slice(i, i + this.pollChunk);
      const envelope = await this.get("/v1/sms/get/", { ids: chunk.join(",") });
      const rows = Array.isArray(envelope.data) ? envelope.data : [];
      for (const row of rows) {
        const receipt = this.parseDeliveryReceipt(row);
        if (receipt) receipts.push(receipt);
      }
    }
    return receipts;
  }

  /** A row of `GET /v1/sms/get/`: `{ id, status, dlr_status }`. Pending states return null. */
  parseDeliveryReceipt(raw: unknown): DeliveryReceipt | null {
    if (raw === null || typeof raw !== "object") return null;
    const r = raw as { id?: unknown; status?: unknown; dlr_status?: unknown };
    const id =
      typeof r.id === "number"
        ? String(r.id)
        : typeof r.id === "string" && r.id !== ""
          ? r.id
          : null;
    if (id === null) return null;
    const dlr = typeof r.dlr_status === "string" ? r.dlr_status.toUpperCase() : "";
    const status = FINAL_DLR[dlr] ?? (r.status === "failed" ? "failed" : undefined);
    if (status === undefined) return null;
    const at = new Date();
    if (status === "delivered") return { providerMessageId: id, status, at };
    return { providerMessageId: id, status, errorCode: dlr || "FAILED", at };
  }

  async priceFor(route: string, country: string): Promise<number | null> {
    return this.prices[`${route}:${country}`] ?? null;
  }

  validateSenderId(
    senderId: string,
    _country: string,
  ): { ok: true } | { ok: false; reason: string } {
    return SENDER_ID_RE.test(senderId)
      ? { ok: true }
      : { ok: false, reason: "Sender ID must be 1 to 11 letters or digits (SMS Edge)" };
  }

  /** The account's routes with a price per country, from `GET /v1/routes/getall/`. */
  async listRoutes(): Promise<SmsEdgeRoute[]> {
    const envelope = await this.get("/v1/routes/getall/", {});
    const rows = Array.isArray(envelope.data) ? envelope.data : [];
    const routes: SmsEdgeRoute[] = [];
    for (const row of rows) {
      if (row === null || typeof row !== "object") continue;
      const r = row as { id?: unknown; name?: unknown; country_name?: unknown; price?: unknown };
      const id = Number(r.id);
      const price = Number(r.price);
      if (!Number.isInteger(id) || typeof r.name !== "string" || !Number.isFinite(price)) continue;
      routes.push({
        id,
        name: r.name,
        countryName: typeof r.country_name === "string" ? r.country_name : "",
        price,
      });
    }
    return routes;
  }

  private async resolveRouteIds(): Promise<Map<string, number>> {
    if (this.routeIds) return this.routeIds;
    const map = new Map<string, number>();
    for (const route of await this.listRoutes()) map.set(smsEdgeRouteKey(route.name), route.id);
    this.routeIds = map;
    return map;
  }

  private url(path: string, params: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("api_key", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.toString();
  }

  /** GET and unwrap; throws with SMS Edge's own error text on failure. */
  private async get(path: string, params: Record<string, string>): Promise<Envelope> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, params), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new Error(
        `SMS Edge ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const envelope = unwrap(await readJson(response));
    if (!response.ok) {
      throw new Error(`SMS Edge ${path} answered ${response.status}${describe(envelope)}`);
    }
    if (envelope?.success !== true) {
      throw new Error(`SMS Edge ${path} refused${describe(envelope)}`);
    }
    return envelope;
  }
}

function describe(envelope: Envelope | null): string {
  const detail = firstError(envelope);
  return detail ? `: ${detail}` : "";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function networkCode(err: unknown): string {
  const text =
    err instanceof Error ? (err.name === "TimeoutError" ? "TIMEOUT" : err.message) : "ERROR";
  return (text.split(/\s/)[0] ?? "ERROR").replace(/[^A-Za-z0-9_]/g, "_") || "ERROR";
}
