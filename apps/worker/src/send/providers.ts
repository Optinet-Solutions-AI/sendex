import {
  createProviderRegistry,
  FakeProvider,
  type ProviderRegistry,
  SmppProvider,
} from "@sendex/providers";

/**
 * The providers this worker can send through, keyed by the `routes.provider` column.
 * `platform` (rented SMS Edge style routes) and `fake` go to the FakeProvider until real
 * platform adapters exist; `smpp` (23Telecom) is registered when SMPP_HOST is configured.
 * Prices come from `route_prices`, so the SMPP provider's own price map stays empty.
 */
export function createDefaultProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
): ProviderRegistry {
  const registry = createProviderRegistry()
    .register("platform", new FakeProvider())
    .register("fake", new FakeProvider());
  const smpp = smppProviderFromEnv(env);
  if (smpp) registry.register("smpp", smpp);
  return registry;
}

export function smppProviderFromEnv(env: NodeJS.ProcessEnv): SmppProvider | null {
  const host = env.SMPP_HOST?.trim();
  const systemId = env.SMPP_SYSTEM_ID?.trim();
  const password = env.SMPP_PASSWORD;
  if (!host || !systemId || !password) return null;
  const port = Number.parseInt(env.SMPP_PORT ?? "2775", 10);
  const windowSize = env.SMPP_WINDOW ? Number.parseInt(env.SMPP_WINDOW, 10) : undefined;
  const tps = env.SMPP_TPS ? Number.parseInt(env.SMPP_TPS, 10) : undefined;
  return new SmppProvider({
    name: env.SMPP_PROVIDER_NAME ?? "smpp",
    host,
    port: Number.isFinite(port) ? port : 2775,
    systemId,
    password,
    ...(env.SMPP_SYSTEM_TYPE ? { systemType: env.SMPP_SYSTEM_TYPE } : {}),
    tls: env.SMPP_TLS === "true",
    ...(windowSize && Number.isFinite(windowSize) ? { windowSize } : {}),
    ...(tps && Number.isFinite(tps) ? { throughputPerSecond: tps } : {}),
    prices: {},
  });
}
