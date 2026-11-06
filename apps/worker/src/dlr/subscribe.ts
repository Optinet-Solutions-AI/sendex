import { type ProviderRegistry, receiptTextOf, SmppProvider } from "@sendex/providers";
import type { DlrJob } from "../jobs.js";
import type { Logger } from "../log.js";

/**
 * The JSON-safe slice of a `deliver_sm` (or anything shaped like one) the dlr handler
 * re-parses: the receipt text and the two receipt TLVs. Addresses are left out, so no phone
 * number travels through Redis, and Buffers are turned into text so the payload survives
 * the queue.
 */
export function smppReceiptRaw(pdu: Record<string, unknown>): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  const text = receiptTextOf(pdu);
  if (text !== null) raw.short_message = text;
  if (typeof pdu.receipted_message_id === "string") {
    raw.receipted_message_id = pdu.receipted_message_id;
  }
  if (typeof pdu.message_state === "number") raw.message_state = pdu.message_state;
  return raw;
}

export interface SubscribeReceiptsDeps {
  registry: ProviderRegistry;
  /** Put the job on the `dlr` queue. */
  enqueue: (job: DlrJob) => Promise<unknown>;
  log: Logger;
}

export interface ReceiptSubscription {
  /** Registry names of the providers subscribed. */
  providers: string[];
  unsubscribe(): void;
}

/**
 * Receipts arrive on the provider's bound SMPP session, not per job: subscribe every SMPP
 * provider in the registry once at boot and enqueue each receipt as a `DlrJob` under the
 * registry name (the `routes.provider` value the handler resolves the provider by). A
 * receipt that cannot be enqueued is logged and lost: the session has already acknowledged
 * it, so the SMSC will not resend; the expiry tick marks the message later.
 */
export function subscribeDeliveryReceipts(deps: SubscribeReceiptsDeps): ReceiptSubscription {
  const unsubscribers: Array<() => void> = [];
  const providers: string[] = [];
  for (const name of deps.registry.names()) {
    const provider = deps.registry.get(name);
    if (!(provider instanceof SmppProvider)) continue;
    providers.push(name);
    unsubscribers.push(
      provider.onDeliveryReceipt((receipt, pdu) => {
        deps.enqueue({ provider: name, raw: smppReceiptRaw(pdu) }).catch((err: unknown) => {
          deps.log("error", "receipt could not be enqueued", {
            provider: name,
            providerMessageId: receipt.providerMessageId,
            status: receipt.status,
            err,
          });
        });
      }),
    );
  }
  return {
    providers,
    unsubscribe() {
      for (const fn of unsubscribers.splice(0)) fn();
    },
  };
}

/**
 * Bind every SMPP provider now rather than on its first send, so receipts for messages
 * sent before a restart flow as soon as the worker is up. A refused bind is logged; the
 * session keeps retrying on its own.
 */
export function connectSmppProviders(registry: ProviderRegistry, log: Logger): void {
  for (const name of registry.names()) {
    const provider = registry.get(name);
    if (!(provider instanceof SmppProvider)) continue;
    provider.connect().then(
      () => log("info", "smpp provider bound", { provider: name }),
      (err: unknown) => log("error", "smpp provider bind failed", { provider: name, err }),
    );
  }
}
