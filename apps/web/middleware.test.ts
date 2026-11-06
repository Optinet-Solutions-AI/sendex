import { type NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseContentSecurityPolicy, SECURITY_HEADER_NAMES } from "./lib/security-headers";

const clerk = vi.hoisted(() => ({ clerkMiddleware: vi.fn(), handler: vi.fn(), protect: vi.fn() }));

vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return { createRouteMatcher: actual.createRouteMatcher, clerkMiddleware: clerk.clerkMiddleware };
});

import { buildMiddleware } from "./middleware";

const event = {} as NextFetchEvent;

type Mode = Parameters<typeof buildMiddleware>[0];

/** The callback `buildMiddleware("clerk")` hands to `clerkMiddleware`. */
type ClerkCallback = (
  auth: { protect: () => Promise<void> },
  req: NextRequest,
  event: NextFetchEvent,
) => Promise<NextResponse | undefined>;

async function run(mode: Mode, path: string, isDev = true) {
  const request = new NextRequest(`http://localhost:3000${path}`);
  const response = await buildMiddleware(mode, isDev)(request, event);
  if (!(response instanceof NextResponse)) throw new Error("expected a NextResponse");
  return response;
}

function nonceOf(response: NextResponse): string {
  const csp = response.headers.get("content-security-policy") ?? "";
  const match = /'nonce-([^']+)'/.exec(csp);
  if (!match?.[1]) throw new Error(`no nonce in policy: ${csp}`);
  return match[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  clerk.protect.mockResolvedValue(undefined);
  // Stand in for the real clerkMiddleware: run our callback with a stub auth, like Clerk does.
  clerk.clerkMiddleware.mockImplementation((callback: ClerkCallback) => {
    clerk.handler.mockImplementation(
      async (req: NextRequest, ev: NextFetchEvent) =>
        (await callback({ protect: clerk.protect }, req, ev)) ?? NextResponse.next(),
    );
    return clerk.handler;
  });
});

describe("buildMiddleware", () => {
  it("passes everything through when auth is unconfigured so the setup page can render", async () => {
    const response = await run("unconfigured", "/campaigns");
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(clerk.clerkMiddleware).not.toHaveBeenCalled();
  });

  it("passes dashboard routes through under the development stub", async () => {
    const response = await run("dev", "/");
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(clerk.clerkMiddleware).not.toHaveBeenCalled();
  });

  it("redirects the Clerk sign-in and sign-up pages to the dashboard under the stub", async () => {
    for (const path of ["/sign-in", "/sign-in/factor-one", "/sign-up"]) {
      const response = await run("dev", path);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/");
    }
  });

  it("delegates to clerkMiddleware with the sign-in URLs when Clerk is configured", async () => {
    const response = await run("clerk", "/campaigns");
    expect(clerk.clerkMiddleware).toHaveBeenCalledWith(expect.any(Function), {
      signInUrl: "/sign-in",
      signUpUrl: "/sign-up",
    });
    expect(clerk.handler).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("protects private routes and leaves public ones open in clerk mode", async () => {
    await run("clerk", "/campaigns");
    expect(clerk.protect).toHaveBeenCalledTimes(1);
    clerk.protect.mockClear();
    for (const path of ["/sign-in", "/sign-up/verify", "/api/webhooks/clerk", "/health"]) {
      await run("clerk", path);
    }
    expect(clerk.protect).not.toHaveBeenCalled();
  });
});

describe("security headers", () => {
  const modes: Mode[] = ["unconfigured", "dev", "clerk"];

  it.each(modes)("sets every security header on a %s mode response", async (mode) => {
    const response = await run(mode, "/", false);
    for (const name of SECURITY_HEADER_NAMES) {
      expect(response.headers.get(name), name).toBeTruthy();
    }
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = parseContentSecurityPolicy(response.headers.get("content-security-policy") ?? "");
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("script-src")).toContain("'strict-dynamic'");
  });

  it.each(modes)("forwards the nonce and policy to the app in %s mode", async (mode) => {
    const response = await run(mode, "/", false);
    const nonce = nonceOf(response);
    // NextResponse.next({ request }) encodes forwarded request headers this way.
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(
      response.headers.get("content-security-policy"),
    );
    expect(response.headers.get("x-middleware-override-headers")).toContain("x-nonce");
  });

  it("uses a fresh nonce for every request", async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 5; i += 1) nonces.add(nonceOf(await run("dev", "/")));
    expect(nonces.size).toBe(5);
  });

  it("tells Clerk's hosts apart from the other modes", async () => {
    const clerkCsp = parseContentSecurityPolicy(
      (await run("clerk", "/", false)).headers.get("content-security-policy") ?? "",
    );
    const devCsp = parseContentSecurityPolicy(
      (await run("dev", "/", false)).headers.get("content-security-policy") ?? "",
    );
    expect(clerkCsp.get("script-src")).toContain("https://*.clerk.accounts.dev");
    expect(devCsp.get("script-src")).not.toContain("https://*.clerk.accounts.dev");
  });

  it("drops HSTS and allows eval and websockets only in development", async () => {
    const dev = await run("dev", "/", true);
    expect(dev.headers.has("strict-transport-security")).toBe(false);
    expect(dev.headers.get("content-security-policy")).toContain("'unsafe-eval'");

    const prod = await run("dev", "/", false);
    expect(prod.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(prod.headers.get("content-security-policy")).not.toContain("'unsafe-eval'");
  });

  it("also secures the stub's sign-in redirect", async () => {
    const response = await run("dev", "/sign-in");
    expect(response.status).toBe(307);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("'nonce-");
  });

  it("keeps its headers when Clerk returns its own response", async () => {
    clerk.clerkMiddleware.mockImplementation(() => {
      clerk.handler.mockImplementation(async () =>
        NextResponse.redirect("http://localhost:3000/sign-in"),
      );
      return clerk.handler;
    });
    const response = await run("clerk", "/campaigns", false);
    expect(response.status).toBe(307);
    expect(response.headers.get("strict-transport-security")).toBeTruthy();
    expect(response.headers.get("content-security-policy")).toContain("'nonce-");
  });
});
