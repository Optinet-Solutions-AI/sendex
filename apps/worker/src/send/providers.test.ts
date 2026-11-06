import type { OutboundMessage } from "@sendex/providers";
import { FakeProvider, SmppProvider, SmsEdgeProvider, Telecom23Provider } from "@sendex/providers";
import { describe, expect, it } from "vitest";
import {
  allowlistedProvider,
  createDefaultProviderRegistry,
  NOT_IN_ALLOWLIST,
  sendAllowlistFromEnv,
  telecom23ProviderFromEnv,
} from "./providers.js";

describe("createDefaultProviderRegistry", () => {
  it("always has the platform and fake providers; platform is fake without an SMS Edge key", () => {
    const registry = createDefaultProviderRegistry({});
    expect(registry.names()).toEqual(["platform", "fake"]);
    expect(registry.get("platform")).toBeInstanceOf(FakeProvider);
  });

  it("serves platform routes through SMS Edge when SMS_EDGE_API_KEY is set", () => {
    const registry = createDefaultProviderRegistry({ SMS_EDGE_API_KEY: " abc " });
    expect(registry.names()).toEqual(["platform", "fake"]);
    const platform = registry.get("platform");
    expect(platform).toBeInstanceOf(SmsEdgeProvider);
    expect(platform.name).toBe("platform");
    expect(
      createDefaultProviderRegistry({ SMS_EDGE_API_KEY: "  " }).get("platform"),
    ).toBeInstanceOf(FakeProvider);
  });

  it("registers 23telecom when TELECOM23_API_KEY is set", () => {
    const registry = createDefaultProviderRegistry({ TELECOM23_API_KEY: "sk_test_x" });
    expect(registry.names()).toEqual(["platform", "fake", "23telecom"]);
    expect(registry.get("23telecom")).toBeInstanceOf(Telecom23Provider);
    expect(registry.get("23telecom").name).toBe("23telecom");
  });

  it("registers smpp only when SMPP_HOST, SMPP_SYSTEM_ID and SMPP_PASSWORD are all set", () => {
    expect(createDefaultProviderRegistry({ SMPP_HOST: "h" }).has("smpp")).toBe(false);
    const registry = createDefaultProviderRegistry({
      SMPP_HOST: "h",
      SMPP_SYSTEM_ID: "s",
      SMPP_PASSWORD: "p",
    });
    expect(registry.get("smpp")).toBeInstanceOf(SmppProvider);
  });

  it("ignores a blank key and trims whitespace", () => {
    expect(telecom23ProviderFromEnv({ TELECOM23_API_KEY: "   " })).toBeNull();
    expect(telecom23ProviderFromEnv({ TELECOM23_API_KEY: " sk_test_x " })).toBeInstanceOf(
      Telecom23Provider,
    );
  });
});

describe("send allowlist (SEND_ALLOWLIST_E164)", () => {
  const allow = (...entries: string[]) => {
    const list = sendAllowlistFromEnv({ SEND_ALLOWLIST_E164: entries.join(",") });
    if (!list) throw new Error("empty allowlist");
    return list;
  };
  const msg = (id: string, to: string): OutboundMessage => ({
    id,
    to,
    senderId: "SENDEX",
    text: "hi",
    encoding: "GSM_7BIT",
    route: "136",
    country: "MT",
  });

  it("parses exact numbers and prefix patterns, and ignores a blank value", () => {
    expect(sendAllowlistFromEnv({})).toBeNull();
    expect(sendAllowlistFromEnv({ SEND_ALLOWLIST_E164: " , " })).toBeNull();
    const list = sendAllowlistFromEnv({
      SEND_ALLOWLIST_E164: "+35699000001, +639170000001\n+356*, +63*",
    });
    expect(list?.numbers).toEqual(new Set(["+35699000001", "+639170000001"]));
    expect(list?.prefixes).toEqual(["+356", "+63"]);
    expect(list?.allows("+35699000001")).toBe(true);
    expect(list?.allows("+35679123456")).toBe(true);
    expect(list?.allows("+639998887777")).toBe(true);
    expect(list?.allows("+447700900000")).toBe(false);
    expect(sendAllowlistFromEnv({ SEND_ALLOWLIST_E164: "*" })?.allows("+1")).toBe(false);
  });

  it("lets only allowlisted recipients reach the carrier and fails the rest as final", async () => {
    const inner = new FakeProvider();
    const p = allowlistedProvider(inner, allow("+35699000001"));
    const out = await p.send([
      msg("a", "+35699000001"),
      msg("b", "+447700900000"),
      msg("c", "+35699000001"),
    ]);
    expect(out).toEqual([
      { id: "a", status: "accepted", providerMessageId: "fake-1" },
      { id: "b", status: "failed", reason: NOT_IN_ALLOWLIST, retryable: false },
      { id: "c", status: "accepted", providerMessageId: "fake-2" },
    ]);
    expect(inner.sent.map((m) => m.id)).toEqual(["a", "c"]);
    expect(p.name).toBe(inner.name);
    expect(p.validateSenderId("SENDEX", "MT")).toEqual({ ok: true });
  });

  it("does not call the carrier at all when nothing in the batch is allowed", async () => {
    const inner = new FakeProvider();
    const p = allowlistedProvider(inner, allow("+35699000001"));
    await p.send([msg("b", "+447700900000")]);
    expect(inner.sent).toEqual([]);
  });

  it("wraps every registered provider when the variable is set", async () => {
    const registry = createDefaultProviderRegistry({ SEND_ALLOWLIST_E164: "+356*,+63*" });
    const out = await registry
      .get("platform")
      .send([msg("x", "+447700900000"), msg("y", "+35699000001")]);
    expect(out[0]).toMatchObject({ status: "failed", reason: NOT_IN_ALLOWLIST });
    expect(out[1]).toMatchObject({ status: "accepted" });
    const plain = createDefaultProviderRegistry({});
    const ok = await plain.get("platform").send([msg("x", "+447700900000")]);
    expect(ok[0]?.status).toBe("accepted");
  });
});
