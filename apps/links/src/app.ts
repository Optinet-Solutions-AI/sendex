import { isValidShortCode } from "@sendex/core/links";
import { type Context, Hono } from "hono";
import { buildClickRecord, type ClickRecord, postClicks } from "./clicks.js";

export type Bindings = {
  SENDEX_VERSION: string;
  /** Origin of apps/worker, e.g. https://worker.sendex.example. Empty disables the fallback. */
  WORKER_URL: string;
  /** Shared with the worker; sent as `x-internal-secret` on every internal call. */
  INTERNAL_API_SECRET: string;
  /** Short code -> link cache. Optional so `wrangler dev` runs before the namespace exists. */
  LINKS?: KVNamespace;
  /** Click records, consumed by this worker's `queue` handler. Falls back to HTTP when absent. */
  CLICKS?: Queue<ClickRecord>;
};

/** What KV holds under `code:<shortCode>`; the worker's `/internal/links/:code` returns the same. */
export interface LinkPayload {
  url: string;
  organisationId: string;
  messageId: string;
  campaignId: string;
  lapId: string;
}

/** A cached link outlives any campaign; the TTL only bounds KV growth. */
export const LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

export const kvKey = (code: string) => `code:${code}`;

function isLinkPayload(value: unknown): value is LinkPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return ["url", "organisationId", "messageId", "campaignId", "lapId"].every(
    (key) => typeof v[key] === "string" && v[key] !== "",
  );
}

/** Ask the worker for a code KV does not know. Any failure is a miss: the user gets a 404. */
async function resolveFromWorker(env: Bindings, code: string): Promise<LinkPayload | null> {
  if (!env.WORKER_URL) return null;
  try {
    const res = await fetch(`${env.WORKER_URL}/internal/links/${code}`, {
      headers: { "x-internal-secret": env.INTERNAL_API_SECRET },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isLinkPayload(body) ? body : null;
  } catch (err) {
    console.error("link resolution failed", err instanceof Error ? err.message : err);
    return null;
  }
}

type AppContext = Context<{ Bindings: Bindings }>;

/** Run `work` after the response is sent; without an execution context (tests) just let it run. */
function defer(c: AppContext, work: Promise<unknown>): void {
  const guarded = work.catch((err: unknown) =>
    console.error("deferred work failed", err instanceof Error ? err.message : err),
  );
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {
    // No execution context outside Workers; the promise still runs.
  }
}

async function resolveLink(c: AppContext, code: string): Promise<LinkPayload | null> {
  const key = kvKey(code);
  const cached = await c.env.LINKS?.get(key, "json");
  if (isLinkPayload(cached)) return cached;
  const resolved = await resolveFromWorker(c.env, code);
  if (resolved && c.env.LINKS) {
    defer(c, c.env.LINKS.put(key, JSON.stringify(resolved), { expirationTtl: LINK_TTL_SECONDS }));
  }
  return resolved;
}

function recordClick(c: AppContext, click: ClickRecord): void {
  const { CLICKS, WORKER_URL, INTERNAL_API_SECRET } = c.env;
  if (CLICKS) {
    defer(c, CLICKS.send(click));
  } else if (WORKER_URL) {
    defer(c, postClicks({ workerUrl: WORKER_URL, secret: INTERNAL_API_SECRET }, [click]));
  }
}

export const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true, version: c.env.SENDEX_VERSION ?? "dev" }));

/**
 * The redirect. Hono routes HEAD here too (`c.req.method` stays "HEAD"): link previewers
 * probe with HEAD and are redirected but never counted, like anything classified as a bot.
 */
app.get("/:code", async (c) => {
  const code = c.req.param("code");
  if (!isValidShortCode(code)) return c.text("Not found", 404);

  const link = await resolveLink(c, code);
  if (!link) return c.text("Not found", 404);

  if (c.req.method !== "HEAD") {
    const click = buildClickRecord(code, c.req.raw, new Date());
    recordClick(c, click);
  }

  c.header("cache-control", "private, no-store");
  return c.redirect(link.url, 302);
});
