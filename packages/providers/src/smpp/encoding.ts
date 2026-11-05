/**
 * Map an outbound message to `submit_sm` parameters.
 *
 * - GSM 03.38 text goes out with `data_coding 0`; node-smpp encodes the string (one septet per
 *   byte, which is what SMSCs expect over SMPP). UCS-2 text goes out with `data_coding 8`.
 * - Long texts are split here (153 GSM septets / 67 UCS-2 code units per part) and concatenated
 *   with a UDH (`esm_class 0x40`, 8-bit reference), so the part count matches `analyseSmsText`.
 * - Alphanumeric senders are TON 5 / NPI 0; E.164 numbers are TON 1 / NPI 1 without the `+`.
 * - `registered_delivery 1` asks the SMSC for a final delivery receipt.
 */

import {
  analyseSmsText,
  GSM_MULTI_LIMIT,
  GSM_SINGLE_LIMIT,
  type SmsEncoding,
  UCS2_MULTI_LIMIT,
  UCS2_SINGLE_LIMIT,
} from "@sendex/core";
import type { OutboundMessage } from "../provider.js";

export const DATA_CODING_GSM7 = 0x00;
export const DATA_CODING_UCS2 = 0x08;
export const ESM_CLASS_UDHI = 0x40;
export const TON_INTERNATIONAL = 0x01;
export const TON_ALPHANUMERIC = 0x05;
export const NPI_UNKNOWN = 0x00;
export const NPI_ISDN = 0x01;
export const REGISTERED_DELIVERY_FINAL = 0x01;

export interface UdhMessage {
  udh: Buffer;
  message: string;
}

/** The `submit_sm` fields we set; node-smpp fills the rest with protocol defaults. */
export interface SubmitSmParams {
  source_addr_ton: number;
  source_addr_npi: number;
  source_addr: string;
  dest_addr_ton: number;
  dest_addr_npi: number;
  destination_addr: string;
  esm_class: number;
  data_coding: number;
  registered_delivery: number;
  short_message: string | UdhMessage;
  [field: string]: unknown;
}

export interface SmppAddress {
  ton: number;
  npi: number;
  address: string;
}

type EncodableMessage = Pick<OutboundMessage, "to" | "senderId" | "text" | "encoding">;

const NUMERIC_RE = /^\+?\d+$/;

/** Billable septets of one character (GSM extension characters cost two). */
function gsmCost(ch: string): number {
  return analyseSmsText(ch).chars;
}

function splitGsm(text: string): string[] {
  if (analyseSmsText(text).chars <= GSM_SINGLE_LIMIT) return [text];
  const parts: string[] = [];
  let current = "";
  let cost = 0;
  for (const ch of text) {
    const c = gsmCost(ch);
    if (cost + c > GSM_MULTI_LIMIT) {
      parts.push(current);
      current = "";
      cost = 0;
    }
    current += ch;
    cost += c;
  }
  parts.push(current);
  return parts;
}

function isHighSurrogate(code: number | undefined): boolean {
  return code !== undefined && code >= 0xd800 && code <= 0xdbff;
}

function splitUcs2(text: string): string[] {
  if (text.length <= UCS2_SINGLE_LIMIT) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + UCS2_MULTI_LIMIT, text.length);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

/** Split a text into SMS parts for the given encoding. A single part is returned when it fits. */
export function splitSmsText(text: string, encoding: SmsEncoding): string[] {
  return encoding === "UCS2" ? splitUcs2(text) : splitGsm(text);
}

/** UDH for 8-bit concatenation: length 5, IEI 0x00, IE length 3, reference, total, sequence. */
export function concatUdh(reference: number, total: number, sequence: number): Buffer {
  return Buffer.from([0x05, 0x00, 0x03, reference & 0xff, total & 0xff, sequence & 0xff]);
}

export function sourceAddress(senderId: string): SmppAddress {
  if (NUMERIC_RE.test(senderId)) {
    return { ton: TON_INTERNATIONAL, npi: NPI_ISDN, address: senderId.replace(/^\+/, "") };
  }
  return { ton: TON_ALPHANUMERIC, npi: NPI_UNKNOWN, address: senderId };
}

export function destinationAddress(to: string): SmppAddress {
  return { ton: TON_INTERNATIONAL, npi: NPI_ISDN, address: to.replace(/^\+/, "") };
}

/**
 * The wire encoding for a message: an explicit UCS-2 request is honoured, and GSM is upgraded to
 * UCS-2 when the text contains characters outside GSM 03.38 (node-smpp would otherwise replace
 * them with spaces).
 */
export function wireEncoding(message: EncodableMessage): SmsEncoding {
  if (message.encoding === "UCS2") return "UCS2";
  return analyseSmsText(message.text).encoding;
}

/**
 * Build the `submit_sm` parameter sets for a message: one per part. `reference` identifies the
 * concatenated message; only its low byte is used.
 */
export function toSubmitSmParams(message: EncodableMessage, reference: number): SubmitSmParams[] {
  const encoding = wireEncoding(message);
  const dataCoding = encoding === "UCS2" ? DATA_CODING_UCS2 : DATA_CODING_GSM7;
  const source = sourceAddress(message.senderId);
  const destination = destinationAddress(message.to);
  const parts = splitSmsText(message.text, encoding);

  const common = {
    source_addr_ton: source.ton,
    source_addr_npi: source.npi,
    source_addr: source.address,
    dest_addr_ton: destination.ton,
    dest_addr_npi: destination.npi,
    destination_addr: destination.address,
    data_coding: dataCoding,
    registered_delivery: REGISTERED_DELIVERY_FINAL,
  };

  if (parts.length === 1) {
    return [{ ...common, esm_class: 0, short_message: parts[0] ?? "" }];
  }
  return parts.map((part, i) => ({
    ...common,
    esm_class: ESM_CLASS_UDHI,
    short_message: { udh: concatUdh(reference, parts.length, i + 1), message: part },
  }));
}
