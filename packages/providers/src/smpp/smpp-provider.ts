/// <reference path="../smpp-types.d.ts" />
/**
 * `SmppProvider`: the Provider implementation for carriers reached over SMPP 3.4 (23Telecom first).
 *
 * One managed transceiver session per provider instance. `send` submits every part of every
 * message through the session window and reports per-message outcomes; it only throws when the
 * session cannot bind at all. Delivery receipts arrive as `deliver_sm` and are parsed by
 * {@link parseDeliveryReceiptPdu}.
 */

import smpp from "smpp";
import type { DeliveryReceipt, OutboundMessage, Provider, SubmitOutcome } from "../provider.js";
import { toSubmitSmParams } from "./encoding.js";
import { parseDeliveryReceiptPdu } from "./receipt.js";
import {
  SmppBindError,
  SmppSession,
  SmppSessionClosedError,
  type SmppSessionOptions,
  SmppTimeoutError,
} from "./session.js";

export type SenderIdRule = (
  senderId: string,
  country: string,
) => { ok: true } | { ok: false; reason: string };

export type SmppSessionTuning = Pick<
  SmppSessionOptions,
  | "enquireLinkIntervalMs"
  | "reconnectMinMs"
  | "reconnectMaxMs"
  | "connectTimeoutMs"
  | "submitTimeoutMs"
  | "bindTimeoutMs"
  | "logger"
>;

export interface SmppProviderOptions {
  name: string;
  host: string;
  port: number;
  systemId: string;
  password: string;
  systemType?: string;
  tls?: boolean;
  /** Maximum in-flight submit_sm. Default 10. */
  windowSize?: number;
  /** Maximum submit_sm per second. Default unlimited. */
  throughputPerSecond?: number;
  /** Price per SMS part in EUR keyed by `${route}:${country}`. */
  prices: Record<string, number>;
  /** Override the default sender id rule (3 to 11 alphanumeric characters). */
  senderIdRules?: SenderIdRule;
  /** Timeouts, backoff and logging for the session. */
  session?: SmppSessionTuning;
}

export type DeliveryReceiptListener = (receipt: DeliveryReceipt, pdu: smpp.PDU) => void;
export type InboundListener = (pdu: smpp.PDU) => void;

const SENDER_ID_RE = /^[A-Za-z0-9]{3,11}$/;
const MAX_PART_ID_ENTRIES = 10_000;

/** Statuses worth retrying later: the SMSC is busy, not the message wrong. */
const RETRYABLE_STATUSES = new Set<number>([smpp.errors.ESME_RTHROTTLED ?? 0x58, 0x14]);

const STATUS_NAMES = new Map<number, string>(
  Object.entries(smpp.errors).map(([name, code]) => [code, name]),
);

/** Symbolic name of an SMPP command_status, e.g. `ESME_RTHROTTLED` for 0x58. */
export function commandStatusName(status: number): string {
  return STATUS_NAMES.get(status) ?? `ESME_0x${status.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

function defaultSenderIdRule(senderId: string): { ok: true } | { ok: false; reason: string } {
  return SENDER_ID_RE.test(senderId)
    ? { ok: true }
    : { ok: false, reason: "Sender ID must be 3 to 11 alphanumeric characters" };
}

export class SmppProvider implements Provider {
  readonly name: string;
  readonly session: SmppSession;
  /** Provider message ids of every part, keyed by our message id (bounded, most recent kept). */
  readonly partIds = new Map<string, string[]>();

  private readonly prices: Record<string, number>;
  private readonly senderIdRule: SenderIdRule;
  private readonly receiptListeners = new Set<DeliveryReceiptListener>();
  private readonly inboundListeners = new Set<InboundListener>();
  private reference = 0;

  constructor(opts: SmppProviderOptions) {
    this.name = opts.name;
    this.prices = opts.prices;
    this.senderIdRule = opts.senderIdRules ?? defaultSenderIdRule;

    const sessionOpts: SmppSessionOptions = {
      ...opts.session,
      host: opts.host,
      port: opts.port,
      systemId: opts.systemId,
      password: opts.password,
    };
    if (opts.systemType !== undefined) sessionOpts.systemType = opts.systemType;
    if (opts.tls !== undefined) sessionOpts.tls = opts.tls;
    if (opts.windowSize !== undefined) sessionOpts.windowSize = opts.windowSize;
    if (opts.throughputPerSecond !== undefined) {
      sessionOpts.throughputPerSecond = opts.throughputPerSecond;
    }
    this.session = new SmppSession(sessionOpts);
    this.session.on("deliver_sm", (pdu) => this.onDeliverSm(pdu));
  }

  /** Bind now instead of on the first send. Rejects with {@link SmppBindError} on refusal. */
  connect(): Promise<void> {
    return this.session.connect();
  }

  /** Unbind and stop reconnecting. */
  close(): Promise<void> {
    return this.session.close();
  }

  /** Subscribe to parsed delivery receipts. Returns the unsubscribe function. */
  onDeliveryReceipt(listener: DeliveryReceiptListener): () => void {
    this.receiptListeners.add(listener);
    return () => {
      this.receiptListeners.delete(listener);
    };
  }

  /** Subscribe to `deliver_sm` PDUs that are not receipts (mobile-originated messages). */
  onInboundMessage(listener: InboundListener): () => void {
    this.inboundListeners.add(listener);
    return () => {
      this.inboundListeners.delete(listener);
    };
  }

  async send(batch: readonly OutboundMessage[]): Promise<SubmitOutcome[]> {
    if (batch.length === 0) return [];
    try {
      await this.session.ready();
    } catch (error) {
      if (error instanceof SmppBindError) throw error;
      throw new SmppBindError(error instanceof Error ? error.message : String(error));
    }
    return Promise.all(batch.map((message) => this.sendOne(message)));
  }

  parseDeliveryReceipt(raw: unknown): DeliveryReceipt | null {
    return parseDeliveryReceiptPdu(raw);
  }

  async priceFor(route: string, country: string): Promise<number | null> {
    return this.prices[`${route}:${country}`] ?? null;
  }

  validateSenderId(
    senderId: string,
    country: string,
  ): { ok: true } | { ok: false; reason: string } {
    return this.senderIdRule(senderId, country);
  }

  // --- internals ------------------------------------------------------------------------------

  private async sendOne(message: OutboundMessage): Promise<SubmitOutcome> {
    const parts = toSubmitSmParams(message, this.nextReference());
    const ids: string[] = [];
    for (const part of parts) {
      let result: Awaited<ReturnType<SmppSession["submit"]>>;
      try {
        result = await this.session.submit(part);
      } catch (error) {
        return { id: message.id, status: "failed", ...failureOf(error) };
      }
      if (result.commandStatus !== 0) {
        return {
          id: message.id,
          status: "failed",
          reason: commandStatusName(result.commandStatus),
          retryable: isRetryableStatus(result.commandStatus),
        };
      }
      ids.push(result.messageId);
    }
    this.rememberPartIds(message.id, ids);
    return { id: message.id, status: "accepted", providerMessageId: ids[0] ?? "" };
  }

  private nextReference(): number {
    this.reference = (this.reference + 1) & 0xff;
    return this.reference;
  }

  private rememberPartIds(messageId: string, ids: string[]): void {
    this.partIds.set(messageId, ids);
    if (this.partIds.size > MAX_PART_ID_ENTRIES) {
      const oldest = this.partIds.keys().next();
      if (!oldest.done) this.partIds.delete(oldest.value);
    }
  }

  private onDeliverSm(pdu: smpp.PDU): void {
    const receipt = parseDeliveryReceiptPdu(pdu);
    if (receipt === null) {
      for (const listener of this.inboundListeners) listener(pdu);
      return;
    }
    for (const listener of this.receiptListeners) listener(receipt, pdu);
  }
}

function failureOf(error: unknown): { reason: string; retryable: boolean } {
  if (error instanceof SmppSessionClosedError) return { reason: "SESSION_CLOSED", retryable: true };
  if (error instanceof SmppTimeoutError) return { reason: "SUBMIT_TIMEOUT", retryable: true };
  return { reason: error instanceof Error ? error.message : String(error), retryable: true };
}
