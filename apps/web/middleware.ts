import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { type NextMiddleware, NextResponse } from "next/server";
import { isClerkConfigured } from "./lib/env";

/** Routes anyone may reach without a session. Everything else requires one. */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/(.*)",
  "/health",
]);

function buildMiddleware(): NextMiddleware {
  if (!isClerkConfigured()) {
    // The root layout renders a setup page explaining which keys to set; do not crash here.
    return () => NextResponse.next();
  }
  return clerkMiddleware(
    async (auth, req) => {
      if (!isPublicRoute(req)) await auth.protect();
    },
    { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
  );
}

export default buildMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files unless they appear in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
