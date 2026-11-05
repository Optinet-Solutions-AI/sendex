/**
 * Same-origin check for route handlers that change state (POST, PUT, PATCH, DELETE).
 *
 * Server actions do not need this: Next already rejects an action whose `Origin` does not match
 * `Host` / `X-Forwarded-Host`. Route handlers get no such check, so any handler a browser can
 * reach with a session cookie must call `assertSameOrigin(request)` before doing anything.
 * Webhooks (Clerk, Stripe) are called by servers, carry no cookie and verify a signature
 * instead, so they must not use this. See docs/engineering/security-headers.md.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface SameOriginOptions {
  /** Extra `host[:port]` values accepted besides the request's own host. */
  allowedHosts?: readonly string[];
}

export class CsrfError extends Error {
  readonly status = 403;
  readonly code = "cross_origin";

  constructor(message: string) {
    super(message);
    this.name = "CsrfError";
  }
}

/** The host the browser believes it is talking to: the proxy's forwarded host wins. */
function requestHost(request: Request): string | null {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host");
}

/** `host[:port]` of the Origin header, or of the Referer when Origin is absent; null if neither parses. */
function sourceHost(request: Request): string | null {
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) return null;
  try {
    return new URL(source).host;
  } catch {
    return null;
  }
}

/** Why the request fails, or null when it is same-origin (or a safe method). */
function crossOriginReason(request: Request, options: SameOriginOptions): string | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  const expected = requestHost(request);
  if (!expected) return "request has no Host header";
  const actual = sourceHost(request);
  if (!actual) return "request has no usable Origin or Referer header";
  if (actual === expected || options.allowedHosts?.includes(actual)) return null;
  return `origin ${actual} does not match host ${expected}`;
}

export function isSameOrigin(request: Request, options: SameOriginOptions = {}): boolean {
  return crossOriginReason(request, options) === null;
}

/** Throws `CsrfError` (403, `cross_origin`) unless the request is same-origin or uses a safe method. */
export function assertSameOrigin(request: Request, options: SameOriginOptions = {}): void {
  const reason = crossOriginReason(request, options);
  if (reason !== null) throw new CsrfError(`Cross-origin request refused: ${reason}.`);
}
