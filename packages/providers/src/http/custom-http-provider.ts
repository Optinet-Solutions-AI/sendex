import { randomUUID } from "node:crypto";
import type { DeliveryReceipt, OutboundMessage, Provider, SubmitOutcome } from "../provider.js";

/**
 * A tenant's own HTTP SMS gateway (Routes > Custom Routes > Add Custom Route, HTTP API):
 * one request per message to a templated URL with `{{{from}}}`, `{{{number}}}` and
 * `{{{text}}}` substituted, basic auth from the username and password, custom headers, GET
 * or POST (POST also carries a JSON body with the same three fields). A 2xx answer is an
 * accepted message; the provider message id is read from a few common JSON keys and falls
 * back to a uuid. Delivery receipts are whatever the gateway posts back as
 * `{ id | message_id, status }`.
 */

export interface CustomHttpProviderOptions {
  name: string;
  apiUrl: string;
  usePost?: boolean;
  username?: string;
  password?: string;
  headers?: ReadonlyArray<{ name: string; value: string }>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  newId?: () => string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const ID_KEYS = ["message_id", "messageId", "id", "msg_id", "reference"] as const;

export function fillTemplate(
  template: string,
  values: { from: string; number: string; text: string },
  encode: boolean,
): string {
  const enc = (v: string) => (encode ? encodeURIComponent(v) : v);
  return template
    .replaceAll("{{{from}}}", enc(values.from))
    .replaceAll("{{{number}}}", enc(values.number))
    .replaceAll("{{{text}}}", enc(values.text));
}

function idFrom(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ID_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number") return String(value);
  }
  const nested = record.data ?? record.result;
  return nested && typeof nested === "object" ? idFrom(nested) : null;
}

const DELIVERED = new Set(["delivered", "DELIVRD", "delivrd", "DELIVERED", "ok", "success"]);
const FAILED = new Set([
  "failed",
  "FAILED",
  "undelivered",
  "UNDELIV",
  "rejected",
  "REJECTD",
  "error",
]);
const EXPIRED = new Set(["expired", "EXPIRED"]);

export class CustomHttpProvider implements Provider {
  readonly name: string;
  private readonly apiUrl: string;
  private readonly usePost: boolean;
  private readonly auth: string | null;
  private readonly headers: ReadonlyArray<{ name: string; value: string }>;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly newId: () => string;

  constructor(opts: CustomHttpProviderOptions) {
    this.name = opts.name;
    this.apiUrl = opts.apiUrl;
    this.usePost = opts.usePost ?? true;
    this.auth =
      opts.username || opts.password
        ? `Basic ${Buffer.from(`${opts.username ?? ""}:${opts.password ?? ""}`).toString("base64")}`
        : null;
    this.headers = opts.headers ?? [];
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.newId = opts.newId ?? randomUUID;
  }

  async send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]> {
    const outcomes: SubmitOutcome[] = [];
    for (const m of batch) outcomes.push(await this.sendOne(m));
    return outcomes;
  }

  private requestFor(m: OutboundMessage): { url: string; init: RequestInit } {
    const values = { from: m.senderId, number: m.to.replace(/^\+/, ""), text: m.text };
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.auth) headers.authorization = this.auth;
    for (const h of this.headers) headers[h.name] = h.value;
    const url = fillTemplate(this.apiUrl, values, true);
    if (!this.usePost) return { url, init: { method: "GET", headers } };
    headers["content-type"] = "application/json";
    return {
      url,
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({ from: values.from, to: values.number, text: values.text }),
      },
    };
  }

  private async sendOne(m: OutboundMessage): Promise<SubmitOutcome> {
    const { url, init } = this.requestFor(m);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const code = err instanceof Error ? err.message.split(/\s/)[0] : "ERROR";
      return {
        id: m.id,
        status: "failed",
        reason: `NETWORK_${(code ?? "ERROR").replace(/[^A-Za-z0-9_]/g, "_")}`,
        retryable: true,
      };
    }
    let body: unknown = null;
    try {
      body = await response.clone().json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      return {
        id: m.id,
        status: "failed",
        reason: `HTTP_${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }
    return { id: m.id, status: "accepted", providerMessageId: idFrom(body) ?? this.newId() };
  }

  /** A gateway callback of `{ id | message_id, status[, error] }`; intermediate states are ignored. */
  parseDeliveryReceipt(raw: unknown): DeliveryReceipt | null {
    if (raw === null || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const id = idFrom(r);
    const status = typeof r.status === "string" ? r.status : null;
    if (!id || !status) return null;
    const at = typeof r.timestamp === "string" ? new Date(r.timestamp) : new Date();
    const when = Number.isNaN(at.getTime()) ? new Date() : at;
    const operator =
      typeof r.operator === "string" && r.operator !== "" ? { operator: r.operator } : {};
    if (DELIVERED.has(status))
      return { providerMessageId: id, status: "delivered", at: when, ...operator };
    if (EXPIRED.has(status))
      return { providerMessageId: id, status: "expired", at: when, ...operator };
    if (FAILED.has(status)) {
      const error = typeof r.error === "string" && r.error !== "" ? r.error : status;
      return { providerMessageId: id, status: "failed", errorCode: error, at: when, ...operator };
    }
    return null;
  }

  /** Prices come from `route_prices`; the gateway has no price list of its own. */
  async priceFor(): Promise<number | null> {
    return null;
  }

  validateSenderId(senderId: string): { ok: true } | { ok: false; reason: string } {
    return /^[A-Za-z0-9 ]{1,11}$|^\+?\d{4,15}$/.test(senderId)
      ? { ok: true }
      : { ok: false, reason: "sender id must be 1 to 11 alphanumeric characters or a number" };
  }

  /**
   * Test Connection: a HEAD (falling back to GET) on the API origin, timed. Returns the
   * latency or throws with the reason.
   */
  async probe(): Promise<{ latencyMs: number; status: number }> {
    const origin = new URL(this.apiUrl).origin;
    const headers: Record<string, string> = {};
    if (this.auth) headers.authorization = this.auth;
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(origin, {
        method: "HEAD",
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 405) {
        response = await this.fetchImpl(origin, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      }
    } catch (err) {
      throw new Error(
        `cannot reach ${origin}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { latencyMs: Date.now() - started, status: response.status };
  }
}
