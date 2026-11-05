import { createProviderRegistry, FakeProvider, type ProviderRegistry } from "@sendex/providers";

/**
 * The providers this worker can send through, keyed by the `routes.provider` column.
 * `platform` (rented SMS Edge style routes) and `fake` both go to the FakeProvider until
 * the real adapters land; `smpp` (23Telecom) is registered by D2-15 and stays unknown
 * until then, so a lap on such a route is cancelled with a clear reason rather than retried.
 */
export function createDefaultProviderRegistry(): ProviderRegistry {
  return createProviderRegistry()
    .register("platform", new FakeProvider())
    .register("fake", new FakeProvider());
}
