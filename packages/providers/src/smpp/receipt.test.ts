import { describe, expect, it } from "vitest";
import {
  parseDeliveryReceiptPdu,
  parseReceiptText,
  parseSmppDate,
  receiptTextOf,
} from "./receipt.js";

const RECEIPT =
  "id:ABC123 sub:001 dlvrd:001 submit date:2611061530 done date:2611061531 stat:DELIVRD err:000 text:hello wor";

describe("parseSmppDate", () => {
  it("parses YYMMDDhhmm and YYMMDDhhmmss as UTC", () => {
    expect(parseSmppDate("2611061530")?.toISOString()).toBe("2026-11-06T15:30:00.000Z");
    expect(parseSmppDate("261106153045")?.toISOString()).toBe("2026-11-06T15:30:45.000Z");
  });

  it("rejects anything else", () => {
    expect(parseSmppDate("")).toBeUndefined();
    expect(parseSmppDate("26110615")).toBeUndefined();
    expect(parseSmppDate("not-a-date")).toBeUndefined();
  });
});

describe("parseReceiptText", () => {
  it("extracts the standard fields", () => {
    expect(parseReceiptText(RECEIPT)).toEqual({
      id: "ABC123",
      sub: "001",
      dlvrd: "001",
      submitDate: new Date("2026-11-06T15:30:00Z"),
      doneDate: new Date("2026-11-06T15:31:00Z"),
      stat: "DELIVRD",
      err: "000",
      text: "hello wor",
    });
  });

  it("tolerates missing optional fields and mixed case keys", () => {
    expect(parseReceiptText("ID:9 STAT:UNDELIV ERR:034")).toMatchObject({
      id: "9",
      stat: "UNDELIV",
      err: "034",
    });
  });

  it("returns null without id and stat", () => {
    expect(parseReceiptText("hello, is this a receipt?")).toBeNull();
    expect(parseReceiptText("id:1 text:no status")).toBeNull();
  });
});

describe("receiptTextOf", () => {
  it("reads a string, a buffer or a node-smpp decoded message", () => {
    expect(receiptTextOf({ short_message: RECEIPT })).toBe(RECEIPT);
    expect(receiptTextOf({ short_message: Buffer.from(RECEIPT, "latin1") })).toBe(RECEIPT);
    expect(receiptTextOf({ short_message: { message: RECEIPT } })).toBe(RECEIPT);
    expect(receiptTextOf({ short_message: { message: Buffer.from(RECEIPT) } })).toBe(RECEIPT);
  });

  it("falls back to message_payload and accepts a bare string", () => {
    expect(receiptTextOf({ short_message: "", message_payload: { message: RECEIPT } })).toBe(
      RECEIPT,
    );
    expect(receiptTextOf(RECEIPT)).toBe(RECEIPT);
    expect(receiptTextOf(42)).toBeNull();
    expect(receiptTextOf({})).toBeNull();
  });
});

describe("parseDeliveryReceiptPdu", () => {
  it("maps DELIVRD to delivered with the done date", () => {
    expect(parseDeliveryReceiptPdu({ short_message: RECEIPT })).toEqual({
      providerMessageId: "ABC123",
      status: "delivered",
      errorCode: "000",
      at: new Date("2026-11-06T15:31:00Z"),
    });
  });

  it("prefers the receipted_message_id TLV over the text id", () => {
    const receipt = parseDeliveryReceiptPdu({
      short_message: { message: RECEIPT },
      receipted_message_id: "TLV-ID",
    });
    expect(receipt?.providerMessageId).toBe("TLV-ID");
  });

  it("maps EXPIRED to expired and anything else to failed", () => {
    expect(
      parseDeliveryReceiptPdu({ short_message: "id:1 stat:EXPIRED err:000 done date:2611060000" }),
    ).toMatchObject({ status: "expired" });
    expect(parseDeliveryReceiptPdu({ short_message: "id:2 stat:UNDELIV err:034" })).toMatchObject({
      providerMessageId: "2",
      status: "failed",
      errorCode: "034",
    });
    expect(parseDeliveryReceiptPdu({ short_message: "id:3 stat:REJECTD err:001" })).toMatchObject({
      status: "failed",
    });
  });

  it("uses the message_state TLV when there is no receipt text", () => {
    expect(
      parseDeliveryReceiptPdu({ short_message: "", receipted_message_id: "X", message_state: 2 }),
    ).toMatchObject({ providerMessageId: "X", status: "delivered" });
    expect(
      parseDeliveryReceiptPdu({ short_message: "", receipted_message_id: "Y", message_state: 3 }),
    ).toMatchObject({ status: "expired" });
    expect(
      parseDeliveryReceiptPdu({ short_message: "", receipted_message_id: "Z", message_state: 5 }),
    ).toMatchObject({ status: "failed" });
  });

  it("falls back to now when the receipt has no done date", () => {
    const before = Date.now();
    const receipt = parseDeliveryReceiptPdu({ short_message: "id:1 stat:DELIVRD" });
    expect(receipt?.at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("returns null for inbound messages and junk", () => {
    expect(parseDeliveryReceiptPdu({ short_message: "STOP" })).toBeNull();
    expect(parseDeliveryReceiptPdu({ nonsense: true })).toBeNull();
    expect(parseDeliveryReceiptPdu(null)).toBeNull();
    expect(parseDeliveryReceiptPdu("hello")).toBeNull();
  });
});
