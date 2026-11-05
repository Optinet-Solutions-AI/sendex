import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from "@sendex/core";
import { describe, expect, it } from "vitest";
import { generateShortCode } from "./short-code.js";

describe("generateShortCode", () => {
  it("returns 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateShortCode();
      expect(code).toHaveLength(SHORT_CODE_LENGTH);
      for (const ch of code) expect(SHORT_CODE_ALPHABET).toContain(ch);
    }
  });

  it("does not repeat itself in practice", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateShortCode()));
    expect(codes.size).toBe(1000);
  });
});
