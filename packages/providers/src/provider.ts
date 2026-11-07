/**
 * The one interface every carrier plugs in behind. Only the worker calls it.
 */

export interface OutboundMessage {
  /** Our message id (uuid). Carriers echo it back in delivery receipts where supported. */
  id: string;
  to: string; // E.164
  senderId: string;
  text: string;
  encoding: "GSM_7BIT" | "UCS2";
  /** Provider-specific route identifier (e.g. the SMPP account or HTTP route code). */
  route: string;
  country: string; // ISO 3166-1 alpha-2
}

export type SubmitOutcome =
  | { id: string; status: "accepted"; providerMessageId: string }
  | { id: string; status: "failed"; reason: string; retryable: boolean };

export interface DeliveryReceipt {
  providerMessageId: string;
  status: "delivered" | "failed" | "expired";
  errorCode?: string;
  at: Date;
  /** The mobile operator that delivered it, when the carrier reports one (Mobile Networks). */
  operator?: string;
}

export interface Provider {
  readonly name: string;
  /** Submit a batch. Must never throw for per-message failures; report them in the outcomes. */
  send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]>;
  /** Turn a raw receipt (SMPP deliver_sm text, HTTP webhook body) into a receipt, or null if unparseable. */
  parseDeliveryReceipt(raw: unknown): DeliveryReceipt | null;
  /** Price per SMS in EUR for a route/country, or null if the provider has no such route. */
  priceFor(route: string, country: string): Promise<number | null>;
  /** Whether a sender id is acceptable for the country on this provider. */
  validateSenderId(senderId: string, country: string): { ok: true } | { ok: false; reason: string };
  /**
   * Ask the carrier for the state of messages it accepted (D2-23): the fallback when a
   * delivery webhook never arrives. Returns a receipt for every id that reached a final
   * state; ids still in flight or unknown to the carrier are left out. Throws only on a
   * transport or authentication failure. Optional: push-only carriers (SMPP) leave it out.
   */
  pollReceipts?(providerMessageIds: readonly string[]): Promise<DeliveryReceipt[]>;
}

export type PollingProvider = Provider & { pollReceipts: NonNullable<Provider["pollReceipts"]> };

export function canPollReceipts(provider: Provider): provider is PollingProvider {
  return typeof provider.pollReceipts === "function";
}
