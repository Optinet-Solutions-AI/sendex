import { describe, expect, it } from "vitest";
import { analyseSmsText, detectEncoding } from "./sms-encoding.js";

describe("detectEncoding", () => {
  it("uses GSM-7 for plain ASCII and the GSM basic set", () => {
    expect(detectEncoding("Hello world 100% bonus @ Rolling Slots!")).toBe("GSM_7BIT");
  });
  it("uses GSM-7 for characters in the GSM extension table", () => {
    expect(detectEncoding("Price: 10€ [today] {now} ~ ^ | \\")).toBe("GSM_7BIT");
  });
  it("switches to UCS-2 for characters outside GSM-7", () => {
    expect(detectEncoding("¿Y si hoy es tu noche? 😀")).toBe("UCS2");
    expect(detectEncoding("Привет")).toBe("UCS2");
  });
});

describe("analyseSmsText", () => {
  it("counts a short GSM-7 message as one part with the right remainder", () => {
    const r = analyseSmsText("Hello");
    expect(r).toEqual({ encoding: "GSM_7BIT", chars: 5, parts: 1, left: 155 });
  });
  it("counts GSM extension characters as two", () => {
    const r = analyseSmsText("10€");
    expect(r.chars).toBe(4);
    expect(r.parts).toBe(1);
  });
  it("splits GSM-7 into 153-character parts after 160", () => {
    expect(analyseSmsText("a".repeat(160)).parts).toBe(1);
    expect(analyseSmsText("a".repeat(161))).toEqual({
      encoding: "GSM_7BIT",
      chars: 161,
      parts: 2,
      left: 306 - 161,
    });
    expect(analyseSmsText("a".repeat(307)).parts).toBe(3);
  });
  it("splits UCS-2 into 67-character parts after 70", () => {
    // "ą" (Polish) is outside GSM-7; "¿" is in the GSM basic set and must not trigger UCS-2.
    const text = "ą".repeat(70);
    expect(analyseSmsText(text)).toEqual({ encoding: "UCS2", chars: 70, parts: 1, left: 0 });
    expect(analyseSmsText(`${text}x`).parts).toBe(2);
    expect(analyseSmsText("ą".repeat(134)).parts).toBe(2);
    expect(analyseSmsText("ą".repeat(135)).parts).toBe(3);
  });
  it("matches the SMS Edge editor on the Rolling Slots text", () => {
    // Seen in the recording: "GSM_7BIT · 100 chars · 1 part · 60 left" for the Spanish text
    // with ¿ replaced by the GSM-7 inverted question mark (which is in the basic set).
    const text =
      "¿Y si hoy es tu noche? 100% hasta 700 EUR + 250 FS esperan en Rolling Slots {{domain}}";
    const r = analyseSmsText(text);
    expect(r.encoding).toBe("GSM_7BIT");
    expect(r.parts).toBe(1);
  });
  it("treats an empty text as zero characters and one part", () => {
    expect(analyseSmsText("")).toEqual({ encoding: "GSM_7BIT", chars: 0, parts: 1, left: 160 });
  });
});
