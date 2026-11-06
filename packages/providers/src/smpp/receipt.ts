/**
 * Delivery receipts: a `deliver_sm` whose text follows the SMPP 3.4 appendix B format
 *
 *   id:IIIIIIIIII sub:SSS dlvrd:DDD submit date:YYMMDDhhmm done date:YYMMDDhhmm stat:DDDDDDD
 *   err:E text:. . . . . . . . .
 *
 * plus the optional `receipted_message_id` and `message_state` TLVs (SMPP 3.4 / 5.0).
 */

import type { DeliveryReceipt } from "../provider.js";

export interface ReceiptFields {
  id: string;
  sub?: string;
  dlvrd?: string;
  submitDate?: Date;
  doneDate?: Date;
  stat: string;
  err?: string;
  text?: string;
}

/** SMPP `message_state` values (SMPP 3.4 section 5.2.28). */
const MESSAGE_STATE = {
  DELIVERED: 2,
  EXPIRED: 3,
} as const;

/** Parse an SMPP receipt timestamp (`YYMMDDhhmm` or `YYMMDDhhmmss`) as UTC. */
export function parseSmppDate(value: string): Date | undefined {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(value);
  if (m === null) return undefined;
  const [, yy = "00", mm = "01", dd = "01", hh = "00", mi = "00", ss = "00"] = m;
  const date = new Date(
    Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)),
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function field(text: string, key: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${key}:(\\S*)`, "i");
  return re.exec(text)?.[1];
}

function dateField(text: string, key: string): Date | undefined {
  const re = new RegExp(`(?:^|\\s)${key}:(\\d{10,12})`, "i");
  const raw = re.exec(text)?.[1];
  return raw === undefined ? undefined : parseSmppDate(raw);
}

/** Parse receipt text into its fields. Returns null unless both `id` and `stat` are present. */
export function parseReceiptText(text: string): ReceiptFields | null {
  const id = field(text, "id");
  const stat = field(text, "stat");
  if (id === undefined || id === "" || stat === undefined || stat === "") return null;
  const fields: ReceiptFields = { id, stat: stat.toUpperCase() };
  const sub = field(text, "sub");
  if (sub !== undefined) fields.sub = sub;
  const dlvrd = field(text, "dlvrd");
  if (dlvrd !== undefined) fields.dlvrd = dlvrd;
  const submitDate = dateField(text, "submit date");
  if (submitDate !== undefined) fields.submitDate = submitDate;
  const doneDate = dateField(text, "done date");
  if (doneDate !== undefined) fields.doneDate = doneDate;
  const err = field(text, "err");
  if (err !== undefined) fields.err = err;
  const textMatch = /(?:^|\s)text:(.*)$/is.exec(text);
  if (textMatch?.[1] !== undefined) fields.text = textMatch[1];
  return fields;
}

function messageToText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("latin1");
  if (typeof value === "object" && value !== null && "message" in value) {
    return messageToText((value as { message: unknown }).message);
  }
  return null;
}

/**
 * The text of a `deliver_sm`-like object: `short_message` first, then `message_payload`. Each may
 * be a string, a Buffer or node-smpp's decoded `{ udh, message }`. A bare string is returned as is.
 */
export function receiptTextOf(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (typeof raw !== "object" || raw === null) return null;
  const pdu = raw as { short_message?: unknown; message_payload?: unknown };
  const short = messageToText(pdu.short_message);
  if (short !== null && short.length > 0) return short;
  const payload = messageToText(pdu.message_payload);
  if (payload !== null && payload.length > 0) return payload;
  return short ?? payload;
}

function statusFromStat(stat: string): DeliveryReceipt["status"] {
  if (stat === "DELIVRD") return "delivered";
  if (stat === "EXPIRED") return "expired";
  return "failed";
}

function statusFromState(state: number): DeliveryReceipt["status"] {
  if (state === MESSAGE_STATE.DELIVERED) return "delivered";
  if (state === MESSAGE_STATE.EXPIRED) return "expired";
  return "failed";
}

/**
 * Turn a `deliver_sm` PDU (or any object shaped like one) into a {@link DeliveryReceipt}.
 * Returns null when it is not a receipt (an inbound message, for example).
 */
export function parseDeliveryReceiptPdu(raw: unknown): DeliveryReceipt | null {
  if (typeof raw !== "object" || raw === null) return null;
  const pdu = raw as { receipted_message_id?: unknown; message_state?: unknown };
  const tlvId = typeof pdu.receipted_message_id === "string" ? pdu.receipted_message_id : undefined;
  const tlvState = typeof pdu.message_state === "number" ? pdu.message_state : undefined;

  const text = receiptTextOf(raw);
  const fields = text === null ? null : parseReceiptText(text);

  if (fields !== null) {
    const receipt: DeliveryReceipt = {
      providerMessageId: tlvId ?? fields.id,
      status: statusFromStat(fields.stat),
      at: fields.doneDate ?? new Date(),
    };
    if (fields.err !== undefined) receipt.errorCode = fields.err;
    return receipt;
  }

  if (tlvId !== undefined && tlvState !== undefined) {
    return { providerMessageId: tlvId, status: statusFromState(tlvState), at: new Date() };
  }
  return null;
}
