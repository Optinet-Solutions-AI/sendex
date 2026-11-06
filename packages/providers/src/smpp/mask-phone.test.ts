import { describe, expect, it } from "vitest";
import { maskPhone } from "./mask-phone.js";

describe("maskPhone", () => {
  it("keeps the plus, the country code and the last two digits", () => {
    expect(maskPhone("+34600123456")).toBe("+34*******56");
    expect(maskPhone("34600123456")).toBe("34*******56");
  });

  it("fully masks very short numbers", () => {
    expect(maskPhone("+12345")).toBe("+*****");
    expect(maskPhone("")).toBe("");
  });

  it("never leaks the middle digits", () => {
    const masked = maskPhone("+447700900123");
    expect(masked).not.toContain("7700900");
    expect(masked).toBe("+44********23");
  });
});
