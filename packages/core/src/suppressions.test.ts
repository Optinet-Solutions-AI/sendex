import { describe, expect, it } from "vitest";
import {
  normaliseSuppressionBatch,
  normaliseSuppressionNumber,
  unsubscribeUrls,
} from "./suppressions.js";

describe("normaliseSuppressionNumber", () => {
  it("reads international numbers with or without the plus, 00 or punctuation", () => {
    expect(normaliseSuppressionNumber("+34 622 000 001")).toEqual({
      e164: "+34622000001",
      country: "ES",
    });
    expect(normaliseSuppressionNumber("34622000001")?.e164).toBe("+34622000001");
    expect(normaliseSuppressionNumber("0034-622-000-001")?.e164).toBe("+34622000001");
    expect(normaliseSuppressionNumber("(44) 7911 123456")?.e164).toBe("+447911123456");
  });

  it("rejects national numbers, junk and blanks", () => {
    expect(normaliseSuppressionNumber("622000001")).toBeNull();
    expect(normaliseSuppressionNumber("hello")).toBeNull();
    expect(normaliseSuppressionNumber("   ")).toBeNull();
  });
});

describe("normaliseSuppressionBatch", () => {
  it("keeps one of each number and reports the rejects", () => {
    const out = normaliseSuppressionBatch([
      "+34622000001",
      "34 622 000 001",
      "junk",
      "",
      "+447911123456",
    ]);
    expect(out.numbers.map((n) => n.e164)).toEqual(["+34622000001", "+447911123456"]);
    expect(out.rejected).toEqual(["junk"]);
  });
});

describe("unsubscribeUrls", () => {
  it("builds the by-dynamic and by-number URLs with the spec's placeholders", () => {
    expect(unsubscribeUrls("https://worker.example/", "acme")).toEqual({
      byDynamic: "https://worker.example/unsubscribe/acme?type=rm-fk&fk={{{dynamic}}}",
      byNumber: "https://worker.example/unsubscribe/acme?type=rm-u&number={{{number}}}",
    });
  });
});
