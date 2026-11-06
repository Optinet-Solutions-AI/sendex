import { type NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ clerkMiddleware: vi.fn(), handler: vi.fn() }));

vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return { createRouteMatcher: actual.createRouteMatcher, clerkMiddleware: clerk.clerkMiddleware };
});

import { buildMiddleware } from "./middleware";

const event = {} as NextFetchEvent;

async function run(mode: Parameters<typeof buildMiddleware>[0], path: string) {
  const request = new NextRequest(`http://localhost:3000${path}`);
  const response = await buildMiddleware(mode)(request, event);
  if (!(response instanceof NextResponse)) throw new Error("expected a NextResponse");
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  clerk.clerkMiddleware.mockReturnValue(clerk.handler);
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

  it("delegates to clerkMiddleware with the sign-in URLs when Clerk is configured", () => {
    expect(buildMiddleware("clerk")).toBe(clerk.handler);
    expect(clerk.clerkMiddleware).toHaveBeenCalledWith(expect.any(Function), {
      signInUrl: "/sign-in",
      signUpUrl: "/sign-up",
    });
  });
});
