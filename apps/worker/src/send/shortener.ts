import { randomInt } from "node:crypto";
import { SHORT_CODE_ALPHABET } from "@sendex/core";
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
  /** The ending asked for after the slash of each link. Default `randomShortPath`. */
  newPath?: () => string;
}

/**
 * Characters after the slash of a short address (D4-24). Three, because the team asked for
 * an address as short as the ones SMS Edge sends; Short.io's own endings are six. Three
 * characters of the unambiguous alphabet are about 175,000 endings per domain, plenty for
 * the account's plan (1,000 links in all). An ending that is already taken is not an
 * error: that link is asked for again and gets Short.io's own ending.
 */
export const SHORT_PATH_LENGTH = 3;

/** A random ending of `SHORT_PATH_LENGTH` characters from the unambiguous alphabet. */
export function randomShortPath(): string {
  let path = "";
  for (let i = 0; i < SHORT_PATH_LENGTH; i += 1) {
    path += SHORT_CODE_ALPHABET.charAt(randomInt(SHORT_CODE_ALPHABET.length));
  }
  return path;
}

const API = "https://api.short.io";
/** Short.io takes up to 1000 links per bulk call. */
const BULK_LIMIT = 1000;
const DEFAULT_DOMAINS_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
/** How often a repeated ending is drawn again within one call before it is sent anyway. */
const PATH_DRAWS = 5;

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
  const newPath = options.newPath ?? randomShortPath;
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
      /** One bulk call per 1000 links; remembers every address Short.io made. */
      async function ask(links: Array<{ originalURL: string; path?: string }>): Promise<void> {
        for (let i = 0; i < links.length; i += BULK_LIMIT) {
          const rows = bulkSchema.parse(
            await call("/links/bulk", {
              method: "POST",
              body: { domain, links: links.slice(i, i + BULK_LIMIT) },
            }),
          );
          for (const row of rows) {
            const short = row.secureShortURL ?? row.shortURL;
            if (row.success !== false && row.originalURL && short) made.set(row.originalURL, short);
          }
        }
      }

      // First with our own short endings, no ending twice in the same call.
      const used = new Set<string>();
      await ask(
        targets.map((originalURL) => {
          let path = newPath();
          for (let draw = 1; draw < PATH_DRAWS && used.has(path); draw += 1) path = newPath();
          used.add(path);
          return { originalURL, path };
        }),
      );
      // An ending already in use on the domain is refused for that one link (409). Those are
      // asked for once more without an ending, so Short.io picks its own. A failure here
      // keeps the links already made; the rest carry our own link.
      const missing = targets.filter((target) => !made.has(target));
      if (missing.length > 0) {
        try {
          await ask(missing.map((originalURL) => ({ originalURL })));
        } catch {
          // Nothing to add: the send loop puts our own link where there is no address.
        }
      }
      return targets.map((target) => made.get(target) ?? null);
    },
  };
}
