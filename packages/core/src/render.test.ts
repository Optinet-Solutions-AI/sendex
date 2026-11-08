import { describe, expect, it } from "vitest";
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from "./links.js";
import { pickRandomWords, renderMessageText, shortLinkLength } from "./render.js";

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

  it("fills the last name, empty when the contact has none", () => {
    const vars = { firstName: "Ana", phone: "+1", domain: null };
    expect(renderMessageText("{{first_name}} {{last_name}}", { ...vars, lastName: "Ruiz" })).toBe(
      "Ana Ruiz",
    );
    expect(renderMessageText("Hi {{ last_name }}!", { ...vars, lastName: null })).toBe("Hi !");
  });

  it("picks one option of each words randomizer", () => {
    const vars = { firstName: null, phone: "+1", domain: null };
    const last = (options: readonly string[]) => options[options.length - 1] ?? "";
    expect(renderMessageText("{Hi|Hello|Hey} there, {win|claim} now", vars, last)).toBe(
      "Hey there, claim now",
    );
  });

  it("does not treat randomizer-like text inside a contact name as a randomizer", () => {
    const first = (options: readonly string[]) => options[0] ?? "";
    expect(
      renderMessageText(
        "Hi {{first_name}}",
        { firstName: "{a|b}", phone: "+1", domain: null },
        first,
      ),
    ).toBe("Hi {a|b}");
  });
});

describe("pickRandomWords", () => {
  it("only picks from the options given", () => {
    for (let i = 0; i < 50; i++) {
      expect(["A", "B", "C"]).toContain(pickRandomWords("{A|B|C}"));
    }
  });

  it("leaves braces without a bar and {{placeholders}} alone", () => {
    expect(pickRandomWords("{single} {{domain}}")).toBe("{single} {{domain}}");
  });
});

describe("shortLinkLength", () => {
  it("is the base URL, a slash and the short code", () => {
    expect(shortLinkLength("https://go.example.com")).toBe(
      "https://go.example.com/".length + SHORT_CODE_LENGTH,
    );
    expect(shortLinkLength("https://go.example.com/")).toBe(
      "https://go.example.com/".length + SHORT_CODE_LENGTH,
    );
  });

  it("falls back to a cautious 50 characters when the base URL is unknown", () => {
    expect(shortLinkLength(undefined)).toBe(50);
    expect(shortLinkLength("  ")).toBe(50);
  });
});

describe("short code alphabet", () => {
  it("has no ambiguous characters and codes are 8 long", () => {
    for (const ch of "0O1lI") expect(SHORT_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(SHORT_CODE_ALPHABET).size).toBe(SHORT_CODE_ALPHABET.length);
    expect(SHORT_CODE_LENGTH).toBe(8);
  });
});
