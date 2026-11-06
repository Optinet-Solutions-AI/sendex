import { SmppProvider, Telecom23Provider } from "@sendex/providers";
import { describe, expect, it } from "vitest";
import { createDefaultProviderRegistry, telecom23ProviderFromEnv } from "./providers.js";

describe("createDefaultProviderRegistry", () => {
  it("always has the platform and fake providers", () => {
    const registry = createDefaultProviderRegistry({});
    expect(registry.names()).toEqual(["platform", "fake"]);
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
