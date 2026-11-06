type Env = Record<string, string | undefined>;

const LOCAL_WORKER = "http://localhost:4000";

/**
 * The address brands and partners use to reach the worker (postback URLs, the public API and
 * its docs): `WORKER_PUBLIC_URL` without a trailing slash. Outside production it falls back to
 * the local worker of `pnpm dev`; in production there is no sensible fallback, so `null` tells
 * the settings pages to say the worker is not deployed yet instead of printing localhost.
 */
export function workerPublicUrl(env: Env = process.env): string | null {
  const configured = env.WORKER_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? null : LOCAL_WORKER;
}
