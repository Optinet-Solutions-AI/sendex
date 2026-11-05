import { analyseSmsText } from "@sendex/core";
import { describe, expect, it } from "vitest";
import {
  concatUdh,
  DATA_CODING_GSM7,
  DATA_CODING_UCS2,
  destinationAddress,
  ESM_CLASS_UDHI,
  sourceAddress,
  splitSmsText,
  toSubmitSmParams,
} from "./encoding.js";

const base = {
  to: "+34600123456",
  senderId: "BIGSPINS",
  text: "hello",
  encoding: "GSM_7BIT" as const,
};

describe("splitSmsText", () => {
  it("keeps a 160 character GSM text in one part and splits 161 into 153 + 8", () => {
    expect(splitSmsText("a".repeat(160), "GSM_7BIT")).toHaveLength(1);
    const parts = splitSmsText("a".repeat(161), "GSM_7BIT");
    expect(parts.map((p) => p.length)).toEqual([153, 8]);
  });

  it("counts GSM extension characters as two septets and never splits the escape pair", () => {
    const text = `${"a".repeat(152)}€${"b".repeat(20)}`;
    const parts = splitSmsText(text, "GSM_7BIT");
    expect(parts[0]).toBe("a".repeat(152));
    expect(parts[1]?.startsWith("€")).toBe(true);
    expect(parts.join("")).toBe(text);
  });

  it("matches analyseSmsText for plain multipart texts", () => {
    for (const n of [1, 70, 71, 160, 161, 306, 307, 459, 460]) {
      const text = "x".repeat(n);
      expect(splitSmsText(text, "GSM_7BIT")).toHaveLength(analyseSmsText(text).parts);
    }
  });

  it("splits UCS-2 at 70 / 67 UTF-16 code units and keeps surrogate pairs together", () => {
    expect(splitSmsText("ñ".repeat(70), "UCS2")).toHaveLength(1);
    expect(splitSmsText("ñ".repeat(71), "UCS2").map((p) => p.length)).toEqual([67, 4]);
    // 66 + 2 (surrogate pair) + 3 = 71 code units; the 67 boundary falls inside the pair.
    const text = `${"a".repeat(66)}😀bbb`;
    expect(analyseSmsText(text).parts).toBe(2);
    const parts = splitSmsText(text, "UCS2");
    expect(parts).toEqual(["a".repeat(66), "😀bbb"]);
  });

  it("returns one empty part for an empty text", () => {
    expect(splitSmsText("", "GSM_7BIT")).toEqual([""]);
  });
});

describe("concatUdh", () => {
  it("builds the 8-bit concatenation information element", () => {
    expect([...concatUdh(0x2a, 2, 1)]).toEqual([0x05, 0x00, 0x03, 0x2a, 0x02, 0x01]);
    expect([...concatUdh(300, 3, 3)]).toEqual([0x05, 0x00, 0x03, 300 % 256, 0x03, 0x03]);
  });
});

describe("addresses", () => {
  it("sends alphanumeric sender ids as TON 5 / NPI 0", () => {
    expect(sourceAddress("BIGSPINS")).toEqual({ ton: 5, npi: 0, address: "BIGSPINS" });
  });

  it("sends numeric senders and E.164 destinations as international ISDN without the plus", () => {
    expect(sourceAddress("+34600000000")).toEqual({ ton: 1, npi: 1, address: "34600000000" });
    expect(destinationAddress("+34600123456")).toEqual({
      ton: 1,
      npi: 1,
      address: "34600123456",
    });
  });
});

describe("toSubmitSmParams", () => {
  it("maps a single GSM message to one submit_sm with data_coding 0 and a receipt request", () => {
    const [part, ...rest] = toSubmitSmParams(base, 7);
    expect(rest).toHaveLength(0);
    expect(part).toMatchObject({
      source_addr_ton: 5,
      source_addr_npi: 0,
      source_addr: "BIGSPINS",
      dest_addr_ton: 1,
      dest_addr_npi: 1,
      destination_addr: "34600123456",
      esm_class: 0,
      data_coding: DATA_CODING_GSM7,
      registered_delivery: 1,
      short_message: "hello",
    });
  });

  it("splits a long GSM text into UDH parts sharing one reference", () => {
    const text = "x".repeat(200);
    const parts = toSubmitSmParams({ ...base, text }, 42);
    expect(parts).toHaveLength(2);
    const messages: string[] = [];
    parts.forEach((part, i) => {
      expect(part.esm_class & ESM_CLASS_UDHI).toBe(ESM_CLASS_UDHI);
      expect(part.data_coding).toBe(DATA_CODING_GSM7);
      if (typeof part.short_message === "string") throw new Error("expected a UDH message");
      expect([...part.short_message.udh]).toEqual([0x05, 0x00, 0x03, 42, 2, i + 1]);
      messages.push(part.short_message.message);
    });
    expect(messages.join("")).toBe(text);
  });

  it("uses data_coding 8 for UCS-2 text", () => {
    const [part] = toSubmitSmParams({ ...base, text: "héllo wörld ✓", encoding: "UCS2" }, 1);
    expect(part?.data_coding).toBe(DATA_CODING_UCS2);
    expect(part?.short_message).toBe("héllo wörld ✓");
  });

  it("upgrades to UCS-2 when the text is not GSM even if the message claims GSM", () => {
    const [part] = toSubmitSmParams({ ...base, text: "čau" }, 1);
    expect(part?.data_coding).toBe(DATA_CODING_UCS2);
  });

  it("respects an explicit UCS-2 encoding for GSM-compatible text", () => {
    const [part] = toSubmitSmParams({ ...base, text: "plain", encoding: "UCS2" }, 1);
    expect(part?.data_coding).toBe(DATA_CODING_UCS2);
  });

  it("wraps the concatenation reference to one byte", () => {
    const [part] = toSubmitSmParams({ ...base, text: "x".repeat(200) }, 256 + 9);
    if (part === undefined || typeof part.short_message === "string") throw new Error("udh");
    expect(part.short_message.udh[3]).toBe(9);
  });
});
