import { z } from "zod";

/**
 * A link shortener put in front of our own tracked links (D4-22, ADR 0011): the SMS carries
 * the shortener's address, which forwards to `${LINKS_BASE_URL}/<shortCode>`, so clicks and
 * conversions are still counted by the links service. The send loop treats every failure
 * here as "send with our own link": a shortener never stops a lap.
 */
export interface LinkShortener {
  /** Hostnames that can carry links right now. */
  domains(): Promise<string[]>;
  /**
   * One short address per target on `domain`, in the order asked; null where the shortener
   * made none. Rejects when the call as a whole is refused.
   */
  shorten(domain: string, targets: readonly string[]): Promise<Array<string | null>>;
}

export interface ShortIoOptions {
  apiKey: string;
  fetch?: typeof fetch;
  /** Milliseconds clock for the domains cache. Default `Date.now`. */
  now?: () => number;
  /** How long the list of domains is reused. Default five minutes. */
  domainsTtlMs?: number;
  /** Give up on a call after this long. Default ten seconds. */
  timeoutMs?: number;
}

const API = "https://api.short.io";
/** Short.io takes up to 1000 links per bulk call. */
const BULK_LIMIT = 1000;
const DEFAULT_DOMAINS_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const domainsSchema = z.array(z.object({ hostname: z.string().min(1), state: z.string() }));

const bulkSchema = z.array(
  z.object({
    originalURL: z.string().optional(),
    secureShortURL: z.string().optional(),
    shortURL: z.string().optional(),
    success: z.boolean().optional(),
  }),
);

/** Short.io over its REST API: the account's set-up domains and bulk link creation. */
export function createShortIoShortener(options: ShortIoOptions): LinkShortener {
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.domainsTtlMs ?? DEFAULT_DOMAINS_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cached: { at: number; hosts: string[] } | null = null;

  async function call(path: string, init: { method: "GET" | "POST"; body?: unknown }) {
    const response = await fetchFn(`${API}${path}`, {
      method: init.method,
      headers: {
        authorization: options.apiKey,
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // The status only: the answer's text is the shortener's, and the key must never be logged.
    if (!response.ok) throw new Error(`Short.io answered ${response.status} for ${path}`);
    return response.json();
  }

  return {
    async domains() {
      if (cached && now() - cached.at < ttl) return cached.hosts;
      const rows = domainsSchema.parse(await call("/api/domains", { method: "GET" }));
      const hosts = rows.filter((d) => d.state === "configured").map((d) => d.hostname);
      cached = { at: now(), hosts };
      return hosts;
    },

    async shorten(domain, targets) {
      const made = new Map<string, string>();
      for (let i = 0; i < targets.length; i += BULK_LIMIT) {
        const links = targets.slice(i, i + BULK_LIMIT).map((originalURL) => ({ originalURL }));
        const rows = bulkSchema.parse(
          await call("/links/bulk", { method: "POST", body: { domain, links } }),
        );
        for (const row of rows) {
          const short = row.secureShortURL ?? row.shortURL;
          if (row.success !== false && row.originalURL && short) made.set(row.originalURL, short);
        }
      }
      return targets.map((target) => made.get(target) ?? null);
    },
  };
}
