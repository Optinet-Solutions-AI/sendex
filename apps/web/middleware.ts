import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { type NextMiddleware, NextResponse } from "next/server";
import { type AuthMode, authMode } from "./lib/env";

/** Routes anyone may reach without a session. Everything else requires one. */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/(.*)",
  "/health",
]);

/** Clerk's hosted pages have nothing to show under the development stub. */
const isClerkPage = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export function buildMiddleware(mode: AuthMode): NextMiddleware {
  switch (mode) {
    case "unconfigured":
      // The root layout renders a setup page explaining which keys to set; do not crash here.
      return () => NextResponse.next();
    case "dev":
      // Every request is the seeded user (see lib/dev-auth.ts); there is nothing to sign in to.
      return (req) =>
        isClerkPage(req) ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
    case "clerk":
      return clerkMiddleware(
        async (auth, req) => {
          if (!isPublicRoute(req)) await auth.protect();
        },
        { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
      );
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
