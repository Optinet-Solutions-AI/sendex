import type { AuthMode } from "./env";

/**
 * Response headers the middleware sets on every request (see docs/engineering/security-headers.md).
 * Pure: no environment reads, so the policy for each mode is unit-tested as data.
 */

export const SECURITY_HEADER_NAMES = [
  "Content-Security-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "X-Frame-Options",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
] as const;

export type SecurityHeaderName = (typeof SECURITY_HEADER_NAMES)[number];

/** HSTS is omitted in development, so it is the one optional key. */
export type SecurityHeaders = Record<
  Exclude<SecurityHeaderName, "Strict-Transport-Security">,
  string
> & { "Strict-Transport-Security"?: string };

export interface SecurityHeaderOptions {
  /** Per-request value from `generateNonce()`; tags the inline scripts Next and Clerk emit. */
  nonce: string;
  /** Clerk mode adds Clerk's hosts; the other modes load nothing from outside the app. */
  mode: AuthMode;
  /** `next dev` needs `eval` and a websocket, and plain http://localhost must not get HSTS. */
  isDev: boolean;
}

/** Request header the app reads to tag its own inline scripts (`headers().get("x-nonce")`). */
export const NONCE_HEADER = "x-nonce";

/** Clerk's frontend API and hosted components (development and production instances). */
export const CLERK_HOSTS = [
  "https://*.clerk.accounts.dev",
  "https://clerk.com",
  "https://*.clerk.com",
] as const;

/** Clerk's bot protection renders a Cloudflare Turnstile challenge in a frame. */
const TURNSTILE_HOST = "https://challenges.cloudflare.com";

/** Clerk's SDK telemetry; set `CLERK_TELEMETRY_DISABLED=1` to stop these requests instead. */
const CLERK_TELEMETRY_HOSTS = [
  "https://clerk-telemetry.com",
  "https://*.clerk-telemetry.com",
] as const;

/** One year, the longest value preload lists accept, plus subdomains. */
const HSTS = "max-age=63072000; includeSubDomains; preload";

/** Base64 with no padding issues, as produced by `generateNonce`; anything else is refused. */
const NONCE_PATTERN = /^[A-Za-z0-9+/]+=*$/;

/** 128 random bits, base64 encoded. Uses Web Crypto so it runs on the edge runtime. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type Directive = readonly [name: string, sources: readonly string[]];

function contentSecurityPolicy({ nonce, mode, isDev }: SecurityHeaderOptions): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("securityHeaders: nonce must be a non-empty base64 string");
  }
  const clerk = mode === "clerk";
  const directives: Directive[] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        // Scripts loaded by a nonced script are trusted; host entries below are the CSP2 fallback.
        "'strict-dynamic'",
        // Next dev evaluates source maps and hot updates with eval; never in production.
        ...(isDev ? ["'unsafe-eval'"] : []),
        ...(clerk ? [...CLERK_HOSTS, TURNSTILE_HOST] : []),
      ],
    ],
    // Tailwind and Next both inject inline style elements; a style nonce is not supported by Next.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // Avatars come from Clerk's image CDN and whatever the customer uploads elsewhere.
    ["img-src", ["'self'", "data:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    [
      "connect-src",
      [
        "'self'",
        ...(clerk ? [...CLERK_HOSTS, ...CLERK_TELEMETRY_HOSTS] : []),
        // Hot module reloading talks to the dev server over a websocket.
        ...(isDev ? ["ws:"] : []),
      ],
    ],
    ...(clerk
      ? ([
          ["frame-src", [TURNSTILE_HOST]],
          ["worker-src", ["'self'", "blob:"]],
        ] satisfies Directive[])
      : []),
    ["frame-ancestors", ["'none'"]],
    ["form-action", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ...(isDev ? [] : ([["upgrade-insecure-requests", []]] satisfies Directive[])),
  ];
  return directives.map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
}

/** The full header set for one request. */
export function securityHeaders(options: SecurityHeaderOptions): SecurityHeaders {
  return {
    "Content-Security-Policy": contentSecurityPolicy(options),
    ...(options.isDev ? {} : { "Strict-Transport-Security": HSTS }),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/**
 * Headers to forward to the app with the request. Next's App Router takes the nonce for its own
 * inline scripts from the `content-security-policy` request header; Clerk's script tags and any
 * page that renders an inline script read `x-nonce`. The incoming headers are not mutated.
 */
export function securityHeadersRequestHeaders(
  incoming: Headers,
  nonce: string,
  headers: SecurityHeaders,
): Headers {
  const forwarded = new Headers(incoming);
  forwarded.set(NONCE_HEADER, nonce);
  forwarded.set("content-security-policy", headers["Content-Security-Policy"]);
  return forwarded;
}

/** Splits a serialized policy into `directive -> sources`, for tests and diagnostics. */
export function parseContentSecurityPolicy(header: string): Map<string, string[]> {
  const parsed = new Map<string, string[]>();
  for (const part of header.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name) parsed.set(name, sources);
  }
  return parsed;
}
