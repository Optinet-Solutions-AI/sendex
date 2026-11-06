import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import {
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
  NextResponse,
} from "next/server";
import { type AuthMode, authMode } from "./lib/env";
import {
  generateNonce,
  type SecurityHeaders,
  securityHeaders,
  securityHeadersRequestHeaders,
} from "./lib/security-headers";

/** Routes anyone may reach without a session. Everything else requires one. */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/(.*)",
  "/health",
]);

/** Clerk's hosted pages have nothing to show under the development stub. */
const isClerkPage = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

/** What one request gets: a fresh nonce, the headers built from it, and a pass-through response. */
interface SecuredRequest {
  headers: SecurityHeaders;
  /** `NextResponse.next()` that forwards `x-nonce` and the policy to the app. */
  next(): NextResponse;
}

function secure(req: NextRequest, mode: AuthMode, isDev: boolean): SecuredRequest {
  const nonce = generateNonce();
  const headers = securityHeaders({ nonce, mode, isDev });
  const requestHeaders = securityHeadersRequestHeaders(req.headers, nonce, headers);
  return { headers, next: () => NextResponse.next({ request: { headers: requestHeaders } }) };
}

type SecuredHandler = (
  req: NextRequest,
  event: NextFetchEvent,
  secured: SecuredRequest,
) => ReturnType<NextMiddleware>;

/**
 * Runs `handler` with a per-request nonce and sets the security headers on whatever it returns
 * (a pass-through, a redirect, or Clerk's own response). See docs/engineering/security-headers.md.
 */
function withSecurityHeaders(
  mode: AuthMode,
  isDev: boolean,
  handler: SecuredHandler,
): NextMiddleware {
  return async (req, event) => {
    const secured = secure(req, mode, isDev);
    const response = (await handler(req, event, secured)) ?? secured.next();
    for (const [name, value] of Object.entries(secured.headers)) response.headers.set(name, value);
    return response;
  };
}

export function buildMiddleware(
  mode: AuthMode,
  isDev: boolean = process.env.NODE_ENV !== "production",
): NextMiddleware {
  switch (mode) {
    case "unconfigured":
      // The root layout renders a setup page explaining which keys to set; do not crash here.
      return withSecurityHeaders(mode, isDev, (_req, _event, secured) => secured.next());
    case "dev":
      // Every request is the seeded user (see lib/dev-auth.ts); there is nothing to sign in to.
      return withSecurityHeaders(mode, isDev, (req, _event, secured) =>
        isClerkPage(req) ? NextResponse.redirect(new URL("/", req.url)) : secured.next(),
      );
    case "clerk": {
      // Clerk calls the callback with the same request object, so the nonce made for the request
      // reaches the pass-through response it returns; Clerk then decorates that response.
      const pending = new WeakMap<NextRequest, SecuredRequest>();
      const clerk = clerkMiddleware(
        async (auth, req) => {
          if (!isPublicRoute(req)) await auth.protect();
          return pending.get(req)?.next();
        },
        { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
      );
      return withSecurityHeaders(mode, isDev, (req, event, secured) => {
        pending.set(req, secured);
        return clerk(req, event);
      });
    }
  }
}

export default buildMiddleware(authMode());

export const config = {
  matcher: [
    // Skip Next.js internals and static files unless they appear in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
