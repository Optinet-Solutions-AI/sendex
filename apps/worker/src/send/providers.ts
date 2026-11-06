import {
  createProviderRegistry,
  FakeProvider,
  type ProviderRegistry,
  SmppProvider,
  SmsEdgeProvider,
  Telecom23Provider,
} from "@sendex/providers";

export const TELECOM23_PROVIDER_NAME = "23telecom";
export const PLATFORM_PROVIDER_NAME = "platform";

/**
 * The providers this worker can send through, keyed by the `routes.provider` column.
 * `platform` (the rented SMS Edge routes) is SmsEdgeProvider when SMS_EDGE_API_KEY is set
 * and the FakeProvider otherwise; `fake` is always the FakeProvider; `23telecom` (their
 * REST API) is registered when TELECOM23_API_KEY is set and `smpp` (23Telecom over SMPP)
 * when SMPP_HOST is configured. Prices come from `route_prices`, so the providers' own
 * price maps stay empty.
 */
export function createDefaultProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
): ProviderRegistry {
  const registry = createProviderRegistry()
    .register(PLATFORM_PROVIDER_NAME, smsEdgeProviderFromEnv(env) ?? new FakeProvider())
    .register("fake", new FakeProvider());
  const telecom23 = telecom23ProviderFromEnv(env);
  if (telecom23) registry.register(TELECOM23_PROVIDER_NAME, telecom23);
  const smpp = smppProviderFromEnv(env);
  if (smpp) registry.register("smpp", smpp);
  return registry;
}

/** `SMS_EDGE_API_KEY`, optional `SMS_EDGE_BASE_URL`. SMS Edge has no sandbox: a key means real sends. */
export function smsEdgeProviderFromEnv(env: NodeJS.ProcessEnv): SmsEdgeProvider | null {
  const apiKey = env.SMS_EDGE_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.SMS_EDGE_BASE_URL?.trim();
  return new SmsEdgeProvider({
    name: PLATFORM_PROVIDER_NAME,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    prices: {},
  });
}

/** `TELECOM23_API_KEY` (sandbox `sk_test_…` or live `sk_prod_…`), optional `TELECOM23_BASE_URL`. */
export function telecom23ProviderFromEnv(env: NodeJS.ProcessEnv): Telecom23Provider | null {
  const apiKey = env.TELECOM23_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.TELECOM23_BASE_URL?.trim();
  return new Telecom23Provider({
    name: TELECOM23_PROVIDER_NAME,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    prices: {},
  });
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
