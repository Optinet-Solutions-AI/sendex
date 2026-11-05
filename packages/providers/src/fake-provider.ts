import type { DeliveryReceipt, OutboundMessage, Provider, SubmitOutcome } from "./provider.js";

export interface FakeProviderOptions {
  /** Fail every Nth message (1-based within a send call). 0 = never fail. */
  failEvery?: number;
  /** Simulated latency per send call, in ms. */
  latencyMs?: number;
  /** Prices keyed by `${route}:${country}`. */
  prices?: Record<string, number>;
}

const SENDER_ID_RE = /^[A-Za-z0-9]{3,11}$/;

/**
 * In-memory provider for development and tests. Deterministic: no randomness.
 */
export class FakeProvider implements Provider {
  readonly name = "fake";
  readonly sent: OutboundMessage[] = [];
  private counter = 0;
  private readonly opts: Required<FakeProviderOptions>;

  constructor(opts: FakeProviderOptions = {}) {
    this.opts = {
      failEvery: opts.failEvery ?? 0,
      latencyMs: opts.latencyMs ?? 0,
      prices: opts.prices ?? { "fake-1:ES": 0.025, "fake-1:FR": 0.036, "fake-1:GB": 0.04 },
    };
  }

  async send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]> {
    if (this.opts.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    }
    return batch.map((m, i) => {
      this.sent.push(m);
      this.counter += 1;
      const shouldFail = this.opts.failEvery > 0 && (i + 1) % this.opts.failEvery === 0;
      if (shouldFail) {
        return { id: m.id, status: "failed", reason: "FAKE_REJECTED", retryable: false };
      }
      return { id: m.id, status: "accepted", providerMessageId: `fake-${this.counter}` };
    });
  }

  parseDeliveryReceipt(raw: unknown): DeliveryReceipt | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as { id?: unknown; stat?: unknown };
    if (typeof r.id !== "string" || typeof r.stat !== "string") return null;
    const status = r.stat === "DELIVRD" ? "delivered" : r.stat === "EXPIRED" ? "expired" : "failed";
    return { providerMessageId: r.id, status, at: new Date() };
  }

  async priceFor(route: string, country: string): Promise<number | null> {
    return this.opts.prices[`${route}:${country}`] ?? null;
  }

  validateSenderId(
    senderId: string,
    _country: string,
  ): { ok: true } | { ok: false; reason: string } {
    return SENDER_ID_RE.test(senderId)
      ? { ok: true }
      : { ok: false, reason: "Sender ID must be 3 to 11 alphanumeric characters" };
  }
}
