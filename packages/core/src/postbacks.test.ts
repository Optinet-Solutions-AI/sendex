import { describe, expect, it } from "vitest";
import {
  buildPostbackUrl,
  canonicalPostbackQuery,
  conversionRates,
  deriveEventKey,
  parseIncomingPostback,
  parsePostbackValue,
  postbackTypeSchema,
  signPostbackQuery,
  verifyPostbackSignature,
} from "./postbacks.js";

const SECRET = "top-secret";
const ORG = "6f3b7d1a-2c4e-4f5a-9b8c-1d2e3f4a5b6c";
const DYN = "0d4d9d2e-3a5f-4b3c-8e9f-6a7b8c9d0e1f";

describe("postbackTypeSchema", () => {
  it("accepts the canonical types and their aliases, ignoring case and spaces", () => {
    expect(postbackTypeSchema.parse("lead")).toBe("lead");
    expect(postbackTypeSchema.parse("registration")).toBe("lead");
    expect(postbackTypeSchema.parse("Registration ")).toBe("lead");
    expect(postbackTypeSchema.parse("sale")).toBe("sale");
    expect(postbackTypeSchema.parse("deposit")).toBe("sale");
    expect(postbackTypeSchema.parse("FTD")).toBe("sale");
  });

  it("rejects unknown types", () => {
    expect(postbackTypeSchema.safeParse("click").success).toBe(false);
    expect(postbackTypeSchema.safeParse("").success).toBe(false);
  });
});

describe("parsePostbackValue", () => {
  it("turns decimal strings and numbers into micro-EUR without float drift", () => {
    expect(parsePostbackValue("12.50")).toBe(12_500_000);
    expect(parsePostbackValue("0.1")).toBe(100_000);
    expect(parsePostbackValue("19.999999")).toBe(19_999_999);
    expect(parsePostbackValue(3)).toBe(3_000_000);
    expect(parsePostbackValue(0.07)).toBe(70_000);
    expect(parsePostbackValue(" 1,5 ")).toBe(1_500_000);
  });

  it("rejects negatives, more than six decimals and junk", () => {
    expect(() => parsePostbackValue("-1")).toThrow();
    expect(() => parsePostbackValue("1.0000001")).toThrow();
    expect(() => parsePostbackValue("abc")).toThrow();
    expect(() => parsePostbackValue(Number.NaN)).toThrow();
    expect(() => parsePostbackValue(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("parseIncomingPostback", () => {
  it("normalises the type, keeps every raw parameter and parses the value", () => {
    const result = parseIncomingPostback({
      type: "deposit",
      dynamic_id: DYN,
      value: "25.00",
      event_key: "ev-1",
      sub_id: "abc",
      sig: "deadbeef",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      type: "sale",
      dynamicId: DYN,
      valueMicro: 25_000_000,
      clientEventKey: "ev-1",
      params: {
        type: "deposit",
        dynamic_id: DYN,
        value: "25.00",
        event_key: "ev-1",
        sub_id: "abc",
      },
    });
  });

  it("accepts a lead without value or event key and stringifies non-string params", () => {
    const result = parseIncomingPostback({ type: "lead", dynamic_id: DYN, attempt: 2, vip: true });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.valueMicro).toBeUndefined();
    expect(result.data.clientEventKey).toBeUndefined();
    expect(result.data.params).toEqual({
      type: "lead",
      dynamic_id: DYN,
      attempt: "2",
      vip: "true",
    });
  });

  it("rejects a missing dynamic id, a bad type or a bad value", () => {
    expect(parseIncomingPostback({ type: "lead" }).success).toBe(false);
    expect(parseIncomingPostback({ type: "lead", dynamic_id: "" }).success).toBe(false);
    expect(parseIncomingPostback({ type: "lead", dynamic_id: "a b" }).success).toBe(false);
    expect(parseIncomingPostback({ type: "nope", dynamic_id: DYN }).success).toBe(false);
    expect(parseIncomingPostback({ type: "sale", dynamic_id: DYN, value: "x" }).success).toBe(
      false,
    );
  });
});

describe("signatures", () => {
  it("canonicalises as a sorted, encoded query string without sig", () => {
    expect(canonicalPostbackQuery({ type: "lead", dynamic_id: "a b", sig: "x", a: "1&2" })).toBe(
      "a=1%262&dynamic_id=a%20b&type=lead",
    );
  });

  it("signs deterministically regardless of key order and verifies", async () => {
    const a = await signPostbackQuery({ type: "lead", dynamic_id: DYN }, SECRET);
    const b = await signPostbackQuery({ dynamic_id: DYN, type: "lead" }, SECRET);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await verifyPostbackSignature({ type: "lead", dynamic_id: DYN, sig: a }, a, SECRET),
    ).toBe(true);
    expect(
      await verifyPostbackSignature({ type: "lead", dynamic_id: DYN }, a.toUpperCase(), SECRET),
    ).toBe(true);
  });

  it("rejects a wrong secret, a tampered parameter, a malformed or missing signature", async () => {
    const sig = await signPostbackQuery({ type: "lead", dynamic_id: DYN }, SECRET);
    expect(await verifyPostbackSignature({ type: "lead", dynamic_id: DYN }, sig, "other")).toBe(
      false,
    );
    expect(await verifyPostbackSignature({ type: "sale", dynamic_id: DYN }, sig, SECRET)).toBe(
      false,
    );
    expect(await verifyPostbackSignature({ type: "lead", dynamic_id: DYN }, "abc", SECRET)).toBe(
      false,
    );
    expect(
      await verifyPostbackSignature({ type: "lead", dynamic_id: DYN }, undefined, SECRET),
    ).toBe(false);
    expect(await verifyPostbackSignature({ type: "lead", dynamic_id: DYN }, sig, "")).toBe(false);
  });
});

describe("buildPostbackUrl", () => {
  it("builds the signed URL the brand should call", async () => {
    const url = await buildPostbackUrl(
      "https://worker.sendex.example/",
      "external",
      { type: "lead", dynamic_id: DYN },
      SECRET,
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://worker.sendex.example/postback/external");
    expect(parsed.searchParams.get("type")).toBe("lead");
    expect(parsed.searchParams.get("dynamic_id")).toBe(DYN);
    expect(parsed.searchParams.get("sig")).toBe(
      await signPostbackQuery({ type: "lead", dynamic_id: DYN }, SECRET),
    );
  });

  it("keeps template placeholders readable", async () => {
    const url = await buildPostbackUrl(
      "http://localhost:4000",
      "external",
      { type: "lead", dynamic_id: "{{dynamic}}" },
      SECRET,
    );
    expect(url).toContain("dynamic_id={{dynamic}}");
  });
});

describe("deriveEventKey", () => {
  it("is deterministic and depends on org, type, dynamic id and client key", async () => {
    const base = { organisationId: ORG, type: "lead" as const, dynamicId: DYN };
    const key = await deriveEventKey(base);
    expect(key).toBe(await deriveEventKey({ ...base }));
    expect(key).toMatch(/^lead_[0-9a-f]{32}$/);
    expect(await deriveEventKey({ ...base, type: "sale" })).not.toBe(key);
    expect(await deriveEventKey({ ...base, dynamicId: "other" })).not.toBe(key);
    expect(await deriveEventKey({ ...base, organisationId: DYN })).not.toBe(key);
    expect(await deriveEventKey({ ...base, clientEventKey: "ev-1" })).not.toBe(key);
    expect(await deriveEventKey({ ...base, clientEventKey: "ev-1" })).toBe(
      await deriveEventKey({ ...base, clientEventKey: "ev-1" }),
    );
  });
});

describe("conversionRates", () => {
  it("computes rates and cost per conversion, null when there is nothing to divide by", () => {
    expect(conversionRates({ sent: 1000, leads: 20, sales: 4, costMicro: 25_000_000 })).toEqual({
      leadRate: 0.02,
      saleRate: 0.004,
      cplMicro: 1_250_000,
      cpsMicro: 6_250_000,
    });
    expect(conversionRates({ sent: 0, leads: 0, sales: 0, costMicro: 0 })).toEqual({
      leadRate: 0,
      saleRate: 0,
      cplMicro: null,
      cpsMicro: null,
    });
  });
});
