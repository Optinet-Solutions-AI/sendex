/**
 * `Telecom23Provider`: the Provider implementation for 23Telecom's REST API
 * (https://docs.23telecom.co.uk, OpenAPI at /openapi.yaml). Sends go to
 * `POST /sms/send-individual` (one text and sender per recipient, up to 1000 per request,
 * `Idempotency-Key` required); delivery reports arrive on the worker's webhook as a
 * `DeliveryEvent` JSON body, which {@link Telecom23Provider.parseDeliveryReceipt} reads.
 *
 * A sandbox key (`sk_test_…`) simulates sends for free: ids start with `test_` and a
 * `DELIVRD` webhook is synthesized about five seconds later. A live key (`sk_prod_…`) sends.
 */

import { createHash } from "node:crypto";
import type { DeliveryReceipt, OutboundMessage, Provider, SubmitOutcome } from "../provider.js";

export const TELECOM23_BASE_URL = "https://restlink23telecom.com/api/v1";

/** The API's own limit per `/sms/send-individual` request is 1000; 100 keeps a request small. */
const DEFAULT_MAX_PER_REQUEST = 100;
const DEFAULT_TIMEOUT_MS = 15_000;

/** 23Telecom's rule: 3 to 11 ASCII alphanumerics, the first one a letter. */
const SENDER_ID_RE = /^[A-Za-z][A-Za-z0-9]{2,10}$/;

export interface Telecom23ProviderOptions {
  /** Registry name. Default `23telecom`. */
  name?: string;
  /** `sk_test_…` (sandbox) or `sk_prod_…` (live). */
  apiKey: string;
  /** Default {@link TELECOM23_BASE_URL}. */
  baseUrl?: string;
  /** Injected for tests. Default `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Messages per HTTP request. Default 100, max 1000. */
  maxPerRequest?: number;
  /** Per-request timeout. Default 15 s. */
  timeoutMs?: number;
  /** Price per SMS part in EUR keyed by `${route}:${country}`; the worker uses `route_prices`. */
  prices?: Record<string, number>;
  /** Parallel status lookups per {@link Telecom23Provider.pollReceipts} call. Default 2. */
  pollConcurrency?: number;
  /**
   * Status lookups per {@link Telecom23Provider.pollReceipts} call; ids beyond it wait for the
   * next poll. Default 50: one lookup per id, and 200 a minute got the worker's IP refused.
   */
  maxPollPerCall?: number;
}

/** Statuses that end a message. Everything else (`SENT`, `ENROUTE`, `ACCEPTD`, `pending`) is on the way. */
const FINAL_STATUSES: Record<string, DeliveryReceipt["status"]> = {
  DELIVRD: "delivered",
  EXPIRED: "expired",
  UNDELIV: "failed",
  REJECTD: "failed",
  UNKNOWN: "failed",
  DELETED: "failed",
  failed: "failed",
  credit_rejected: "failed",
};

export function isFinalDeliveryStatus(status: string): boolean {
  return Object.hasOwn(FINAL_STATUSES, status);
}

/** Sandbox message ids start with this; they live 24 h and only answer to a sandbox key. */
const SANDBOX_ID_PREFIX = "test_";
/** Error code written on a sandbox message that is retired because the key went live. */
export const SANDBOX_MESSAGE_ERROR_CODE = "SANDBOX_MESSAGE";

/** Per-recipient `results[].status` values that are the message's fault, not the moment's. */
const FINAL_RESULT_STATUSES = new Set([
  "blocked_country",
  "message_too_long",
  "unpriced",
  "config_error",
]);

/**
 * Stable key for one logical batch: the same message ids (in any order) give the same key, so
 * a retry after a timeout replays the stored response instead of sending twice.
 */
export function telecom23IdempotencyKey(messageIds: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...messageIds].sort().join("\n"))
    .digest("hex");
  return `sendex-${digest.slice(0, 40)}`;
}

interface ResultEntry {
  dnis?: unknown;
  message_id?: unknown;
  status?: unknown;
}

function retryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function errorCodeOf(body: unknown, fallback: string): string {
  if (body !== null && typeof body === "object") {
    const code = (body as { error_code?: unknown }).error_code;
    if (typeof code === "string" && code !== "") return code;
  }
  return fallback;
}

export class Telecom23Provider implements Provider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly maxPerRequest: number;
  private readonly timeoutMs: number;
  private readonly prices: Record<string, number>;
  private readonly pollConcurrency: number;
  private readonly maxPollPerCall: number;

  constructor(opts: Telecom23ProviderOptions) {
    this.name = opts.name ?? "23telecom";
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? TELECOM23_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.maxPerRequest = Math.max(1, Math.min(opts.maxPerRequest ?? DEFAULT_MAX_PER_REQUEST, 1000));
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.prices = opts.prices ?? {};
    this.pollConcurrency = Math.max(1, opts.pollConcurrency ?? 2);
    this.maxPollPerCall = Math.max(1, opts.maxPollPerCall ?? 50);
  }

  /** Sandbox keys start with `sk_test_`; everything else is treated as live. */
  private get isSandboxKey(): boolean {
    return this.apiKey.startsWith("sk_test_");
  }

  async send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]> {
    const outcomes: SubmitOutcome[] = [];
    for (let start = 0; start < batch.length; start += this.maxPerRequest) {
      const chunk = batch.slice(start, start + this.maxPerRequest);
      outcomes.push(...(await this.sendChunk(chunk)));
    }
    return outcomes;
  }

  private async sendChunk(chunk: readonly OutboundMessage[]): Promise<SubmitOutcome[]> {
    const failAll = (reason: string, retryable: boolean): SubmitOutcome[] =>
      chunk.map((m) => ({ id: m.id, status: "failed", reason, retryable }));

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/sms/send-individual`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json",
          "idempotency-key": telecom23IdempotencyKey(chunk.map((m) => m.id)),
        },
        body: JSON.stringify({
          messages: chunk.map((m) => ({ to: m.to, message: m.text, sender_id: m.senderId })),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const code = err instanceof Error ? err.message.split(/\s/)[0] : "ERROR";
      return failAll(`NETWORK_${(code ?? "ERROR").replace(/[^A-Za-z0-9_]/g, "_")}`, true);
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const code = errorCodeOf(
        body,
        response.statusText.replace(/\s+/g, "_").toUpperCase() || "ERROR",
      );
      return failAll(`HTTP_${response.status}_${code}`, retryableHttpStatus(response.status));
    }

    const results = Array.isArray((body as { results?: unknown } | null)?.results)
      ? ((body as { results: unknown[] }).results as ResultEntry[])
      : [];
    const byNumber = new Map<string, ResultEntry>();
    for (const r of results) if (typeof r?.dnis === "string") byNumber.set(r.dnis, r);

    return chunk.map((m, i) => {
      const positional = results[i];
      const r = positional && positional.dnis === m.to ? positional : byNumber.get(m.to);
      if (!r) return { id: m.id, status: "failed", reason: "NO_RESULT", retryable: true };
      const status = typeof r.status === "string" ? r.status : "";
      if (status === "accepted" && typeof r.message_id === "string" && r.message_id !== "") {
        return { id: m.id, status: "accepted", providerMessageId: r.message_id };
      }
      const reason = (status || "NO_STATUS").toUpperCase();
      return { id: m.id, status: "failed", reason, retryable: !FINAL_RESULT_STATUSES.has(status) };
    });
  }

  /** The delivery webhook body. Intermediate states return null and must not reach the queue. */
  parseDeliveryReceipt(raw: unknown): DeliveryReceipt | null {
    if (raw === null || typeof raw !== "object") return null;
    const r = raw as {
      message_id?: unknown;
      status?: unknown;
      status_code?: unknown;
      timestamp?: unknown;
    };
    if (typeof r.message_id !== "string" || r.message_id === "") return null;
    if (typeof r.status !== "string") return null;
    const status = FINAL_STATUSES[r.status];
    if (status === undefined) return null;
    const parsed = typeof r.timestamp === "string" ? new Date(r.timestamp) : new Date(Number.NaN);
    const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    if (status === "delivered") return { providerMessageId: r.message_id, status, at };
    const code =
      typeof r.status_code === "string" && r.status_code !== "" && r.status_code !== "000";
    return {
      providerMessageId: r.message_id,
      status,
      errorCode: code ? String(r.status_code) : r.status,
      at,
    };
  }

  /**
   * The receipt poll fallback (D2-23): `GET /sms/status/{id}` per id, a few in parallel.
   * The sandbox synthesizes one webhook per message with no retries and a bounded pool, and
   * the docs say a live delivery report is not guaranteed either, so `sent` messages whose
   * webhook never came are asked about here. Only final states come back.
   */
  async pollReceipts(providerMessageIds: readonly string[]): Promise<DeliveryReceipt[]> {
    const receipts: DeliveryReceipt[] = [];
    const toLookUp: string[] = [];
    for (const id of providerMessageIds) {
      // A sandbox id (`test_…`) can only be read with a sandbox key; under a live key the
      // carrier answers 404 forever, so retire it instead of asking every minute.
      if (id.startsWith(SANDBOX_ID_PREFIX) && !this.isSandboxKey) {
        receipts.push({
          providerMessageId: id,
          status: "expired",
          errorCode: SANDBOX_MESSAGE_ERROR_CODE,
          at: new Date(),
        });
      } else if (toLookUp.length < this.maxPollPerCall) {
        toLookUp.push(id);
      }
    }
    for (let i = 0; i < toLookUp.length; i += this.pollConcurrency) {
      const chunk = toLookUp.slice(i, i + this.pollConcurrency);
      const found = await Promise.all(chunk.map((id) => this.fetchStatus(id)));
      for (const r of found) if (r) receipts.push(r);
    }
    return receipts;
  }

  private async fetchStatus(providerMessageId: string): Promise<DeliveryReceipt | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/sms/status/${encodeURIComponent(providerMessageId)}`,
        {
          headers: { "x-api-key": this.apiKey, accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`23telecom status lookup failed: ${reason}`);
    }
    if (response.status === 404) return null;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const code = errorCodeOf(body, response.statusText || "ERROR");
      throw new Error(`23telecom status lookup answered ${response.status} ${code}`);
    }
    const message = (body as { message?: unknown } | null)?.message;
    if (message === null || typeof message !== "object") return null;
    const m = message as { timestamp?: unknown; delivered_at?: unknown };
    return this.parseDeliveryReceipt({ ...m, timestamp: m.timestamp ?? m.delivered_at });
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
      : {
          ok: false,
          reason: "Sender ID must be 3 to 11 letters or digits and start with a letter (23Telecom)",
        };
  }
}
