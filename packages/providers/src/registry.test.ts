import { describe, expect, it } from "vitest";
import { FakeProvider } from "./fake-provider.js";
import { createProviderRegistry, resolveProviderForRoute } from "./registry.js";

describe("createProviderRegistry", () => {
  it("registers and returns providers by name", () => {
    const registry = createProviderRegistry();
    const fake = new FakeProvider();
    registry.register("fake", fake);
    expect(registry.get("fake")).toBe(fake);
    expect(registry.has("fake")).toBe(true);
    expect(registry.has("smpp")).toBe(false);
    expect(registry.names()).toEqual(["fake"]);
  });

  it("returns a chainable registry from register", () => {
    const registry = createProviderRegistry()
      .register("a", new FakeProvider())
      .register("b", new FakeProvider());
    expect(registry.names()).toEqual(["a", "b"]);
  });

  it("throws a clear error for an unknown provider", () => {
    const registry = createProviderRegistry();
    registry.register("fake", new FakeProvider());
    expect(() => registry.get("smpp")).toThrowError(
      'Unknown provider "smpp". Registered providers: fake',
    );
  });

  it("lists registered names when none are registered", () => {
    const registry = createProviderRegistry();
    expect(registry.names()).toEqual([]);
    expect(() => registry.get("x")).toThrowError(
      'Unknown provider "x". Registered providers: none',
    );
  });

  it("rejects registering the same name twice", () => {
    const registry = createProviderRegistry();
    registry.register("fake", new FakeProvider());
    expect(() => registry.register("fake", new FakeProvider())).toThrowError(
      'Provider "fake" is already registered',
    );
  });
});

describe("resolveProviderForRoute", () => {
  it("returns the provider named by the route", () => {
    const registry = createProviderRegistry();
    const fake = new FakeProvider();
    registry.register("fake", fake);
    expect(resolveProviderForRoute(registry, { provider: "fake" })).toBe(fake);
  });

  it("throws when the route names an unregistered provider", () => {
    const registry = createProviderRegistry();
    expect(() => resolveProviderForRoute(registry, { provider: "23telecom" })).toThrowError(
      /Unknown provider "23telecom"/,
    );
  });
});
