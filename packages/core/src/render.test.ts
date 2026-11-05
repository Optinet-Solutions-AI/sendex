import { describe, expect, it } from "vitest";
import { renderMessageText, SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from "./render.js";

describe("renderMessageText", () => {
  it("replaces first_name, phone and domain placeholders", () => {
    const out = renderMessageText("Hi {{first_name}} ({{phone}}): {{domain}}", {
      firstName: "Ana",
      phone: "+34600000001",
      domain: "http://localhost:8787/abcdefgh",
    });
    expect(out).toBe("Hi Ana (+34600000001): http://localhost:8787/abcdefgh");
  });

  it("renders a missing first name as empty and tolerates spaces inside the braces", () => {
    expect(
      renderMessageText("Hi {{ first_name }}, go {{domain}}", {
        firstName: null,
        phone: "+1",
        domain: null,
      }),
    ).toBe("Hi , go ");
  });

  it("replaces every occurrence and leaves unknown placeholders alone", () => {
    expect(
      renderMessageText("{{phone}} {{phone}} {{dynamic}}", {
        firstName: "x",
        phone: "+1",
        domain: "d",
      }),
    ).toBe("+1 +1 {{dynamic}}");
  });
});

describe("short code alphabet", () => {
  it("has no ambiguous characters and codes are 8 long", () => {
    for (const ch of "0O1lI") expect(SHORT_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(SHORT_CODE_ALPHABET).size).toBe(SHORT_CODE_ALPHABET.length);
    expect(SHORT_CODE_LENGTH).toBe(8);
  });
});
