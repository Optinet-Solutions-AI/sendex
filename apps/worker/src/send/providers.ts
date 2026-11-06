import {
  createProviderRegistry,
  FakeProvider,
  type OutboundMessage,
  type Provider,
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
  const allowlist = sendAllowlistFromEnv(env);
  const guard = (p: Provider): Provider => (allowlist ? allowlistedProvider(p, allowlist) : p);
  const registry = createProviderRegistry()
    .register(PLATFORM_PROVIDER_NAME, guard(smsEdgeProviderFromEnv(env) ?? new FakeProvider()))
    .register("fake", guard(new FakeProvider()));
  const telecom23 = telecom23ProviderFromEnv(env);
  if (telecom23) registry.register(TELECOM23_PROVIDER_NAME, guard(telecom23));
  const smpp = smppProviderFromEnv(env);
  if (smpp) registry.register("smpp", guard(smpp));
  return registry;
}

/** Why a message was refused by {@link allowlistedProvider}; final, so the send loop refunds it. */
export const NOT_IN_ALLOWLIST = "NOT_IN_ALLOWLIST";

/** Exact E.164 numbers and `+prefix*` patterns a send is allowed to go to. */
export interface SendAllowlist {
  numbers: ReadonlySet<string>;
  prefixes: readonly string[];
  allows(e164: string): boolean;
}

/**
 * `SEND_ALLOWLIST_E164`: comma or whitespace separated entries, each an exact E.164 number
 * (`+35699000001`) or a prefix with a trailing `*` (`+356*` for every Maltese number). When
 * set, every provider refuses any other recipient before the carrier is called. A safety net
 * for the first live sends (D2-18): it makes a seeded or mistaken list harmless. Unset in
 * normal operation.
 */
export function sendAllowlistFromEnv(env: NodeJS.ProcessEnv): SendAllowlist | null {
  const raw = env.SEND_ALLOWLIST_E164?.trim();
  if (!raw) return null;
  const entries = raw.split(/[\s,]+/).filter((n) => n !== "");
  if (entries.length === 0) return null;
  const numbers = new Set(entries.filter((e) => !e.endsWith("*")));
  const prefixes = entries.filter((e) => e.endsWith("*")).map((e) => e.slice(0, -1));
  return {
    numbers,
    prefixes,
    allows: (e164) => numbers.has(e164) || prefixes.some((p) => p !== "" && e164.startsWith(p)),
  };
}

/** Wrap a provider so only recipients the allowlist allows reach it; the rest fail as {@link NOT_IN_ALLOWLIST}. */
export function allowlistedProvider(inner: Provider, allowlist: SendAllowlist): Provider {
  const guarded: Provider = {
    name: inner.name,
    async send(batch: readonly OutboundMessage[]) {
      const allowed = batch.filter((m) => allowlist.allows(m.to));
      const sent = allowed.length > 0 ? await inner.send(allowed) : [];
      const byId = new Map(sent.map((o) => [o.id, o]));
      return batch.map(
        (m) =>
          byId.get(m.id) ?? {
            id: m.id,
            status: "failed" as const,
            reason: NOT_IN_ALLOWLIST,
            retryable: false,
          },
      );
    },
    parseDeliveryReceipt: (raw) => inner.parseDeliveryReceipt(raw),
    priceFor: (route, country) => inner.priceFor(route, country),
    validateSenderId: (senderId, country) => inner.validateSenderId(senderId, country),
  };
  const poll = inner.pollReceipts?.bind(inner);
  if (poll) guarded.pollReceipts = poll;
  return guarded;
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
