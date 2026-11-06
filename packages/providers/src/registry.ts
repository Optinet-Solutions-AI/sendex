import type { Provider } from "./provider.js";

/**
 * Name -> Provider lookup for the worker. Providers are registered once at boot
 * and resolved per route (every route row names the provider that serves it).
 */
export interface ProviderRegistry {
  /** Register a provider under a unique name. Chainable. */
  register(name: string, provider: Provider): ProviderRegistry;
  /** The provider registered under `name`, or throws a clear error. */
  get(name: string): Provider;
  has(name: string): boolean;
  /** Registered names in registration order. */
  names(): string[];
}

export function createProviderRegistry(): ProviderRegistry {
  const providers = new Map<string, Provider>();

  const registry: ProviderRegistry = {
    register(name, provider) {
      if (providers.has(name)) {
        throw new Error(`Provider "${name}" is already registered`);
      }
      providers.set(name, provider);
      return registry;
    },
    get(name) {
      const provider = providers.get(name);
      if (!provider) {
        const known = providers.size === 0 ? "none" : [...providers.keys()].join(", ");
        throw new Error(`Unknown provider "${name}". Registered providers: ${known}`);
      }
      return provider;
    },
    has(name) {
      return providers.has(name);
    },
    names() {
      return [...providers.keys()];
    },
  };

  return registry;
}

/** The minimal shape of a route row the worker needs to pick a provider. */
export interface RouteProviderRef {
  provider: string;
}

/** Resolve the provider a route is served by. Throws when the route names an unknown provider. */
export function resolveProviderForRoute(
  registry: ProviderRegistry,
  route: RouteProviderRef,
): Provider {
  return registry.get(route.provider);
}
