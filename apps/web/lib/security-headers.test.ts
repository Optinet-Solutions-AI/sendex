import { describe, expect, it } from "vitest";
import {
  generateNonce,
  parseContentSecurityPolicy,
  securityHeaders,
  securityHeadersRequestHeaders,
} from "./security-headers";

const NONCE = "dGVzdC1ub25jZQ==";

function csp(options: Parameters<typeof securityHeaders>[0]) {
  return parseContentSecurityPolicy(securityHeaders(options)["Content-Security-Policy"]);
}

describe("generateNonce", () => {
  it("returns base64 of at least 16 random bytes and differs per call", () => {
    const first = generateNonce();
    const second = generateNonce();
    expect(first).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(first, "base64").length).toBeGreaterThanOrEqual(16);
    expect(first).not.toBe(second);
  });
});

describe("parseContentSecurityPolicy", () => {
  it("splits the header into directives and their sources", () => {
    const parsed = parseContentSecurityPolicy(
      "default-src 'self'; img-src 'self' data: ; object-src 'none'",
    );
    expect(parsed).toEqual(
      new Map([
        ["default-src", ["'self'"]],
        ["img-src", ["'self'", "data:"]],
        ["object-src", ["'none'"]],
      ]),
    );
  });
});

describe("securityHeaders", () => {
  it("sets every static header in production", () => {
    const headers = securityHeaders({ nonce: NONCE, mode: "clerk", isDev: false });
    expect(headers).toMatchObject({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    expect(headers["Content-Security-Policy"]).toContain(`'nonce-${NONCE}'`);
  });

  it("omits HSTS in development so plain http://localhost keeps working", () => {
    const headers = securityHeaders({ nonce: NONCE, mode: "dev", isDev: true });
    expect(headers).not.toHaveProperty("Strict-Transport-Security");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("builds a strict nonce-based policy for the production dashboard", () => {
    const directives = csp({ nonce: NONCE, mode: "unconfigured", isDev: false });
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("script-src")).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      "'strict-dynamic'",
    ]);
    expect(directives.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives.get("img-src")).toEqual(["'self'", "data:", "https:"]);
    expect(directives.get("font-src")).toEqual(["'self'", "data:"]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("upgrade-insecure-requests")).toEqual([]);
    expect(directives.has("worker-src")).toBe(false);
    expect(directives.has("frame-src")).toBe(false);
  });

  it("allows Clerk's hosts for scripts, connections, frames and workers in clerk mode", () => {
    const directives = csp({ nonce: NONCE, mode: "clerk", isDev: false });
    const clerkHosts = ["https://*.clerk.accounts.dev", "https://clerk.com", "https://*.clerk.com"];
    expect(directives.get("script-src")).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      "'strict-dynamic'",
      ...clerkHosts,
      "https://challenges.cloudflare.com",
    ]);
    expect(directives.get("connect-src")).toEqual([
      "'self'",
      ...clerkHosts,
      "https://clerk-telemetry.com",
      "https://*.clerk-telemetry.com",
    ]);
    expect(directives.get("frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    expect(directives.get("worker-src")).toEqual(["'self'", "blob:"]);
  });

  it("relaxes only what Next dev needs: eval for source maps, ws for HMR, no upgrade", () => {
    const directives = csp({ nonce: NONCE, mode: "dev", isDev: true });
    expect(directives.get("script-src")).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      "'strict-dynamic'",
      "'unsafe-eval'",
    ]);
    expect(directives.get("connect-src")).toEqual(["'self'", "ws:"]);
    expect(directives.has("upgrade-insecure-requests")).toBe(false);
  });

  it("never allows unsafe-eval or websockets outside development", () => {
    for (const mode of ["clerk", "dev", "unconfigured"] as const) {
      const policy = securityHeaders({ nonce: NONCE, mode, isDev: false })[
        "Content-Security-Policy"
      ];
      expect(policy).not.toContain("'unsafe-eval'");
      expect(policy).not.toContain("ws:");
    }
  });

  it("rejects a nonce that could break out of an attribute or the header", () => {
    for (const nonce of ["", "a b", "x'y", "<script>", "a;b"]) {
      expect(() => securityHeaders({ nonce, mode: "dev", isDev: true })).toThrow(/nonce/);
    }
  });
});

describe("securityHeadersRequestHeaders", () => {
  it("forwards the nonce and the policy so Next and Clerk can tag their inline scripts", () => {
    const incoming = new Headers({ accept: "text/html", cookie: "a=1" });
    const headers = securityHeaders({ nonce: NONCE, mode: "clerk", isDev: false });
    const forwarded = securityHeadersRequestHeaders(incoming, NONCE, headers);
    expect(forwarded.get("x-nonce")).toBe(NONCE);
    expect(forwarded.get("content-security-policy")).toBe(headers["Content-Security-Policy"]);
    expect(forwarded.get("cookie")).toBe("a=1");
    // The incoming headers are left alone.
    expect(incoming.has("x-nonce")).toBe(false);
  });
});
