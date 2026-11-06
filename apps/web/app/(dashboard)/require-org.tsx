import type { Action } from "@sendex/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { AuthError, type OrgContext, requireAction, requireOrg } from "../../lib/auth";

/** Renders an `AuthError` as a page body instead of crashing the route. */
export function AuthErrorView({ error }: { error: AuthError }) {
  return (
    <section className="mx-auto max-w-lg rounded border border-neutral-200 bg-white p-6">
      <h1 className="text-lg font-semibold">
        {error.status === 401 ? "Sign in required" : "Not allowed"}
      </h1>
      <p className="mt-2 text-sm text-neutral-600">{error.message}</p>
      {error.code === "unauthenticated" ? (
        <Link href="/sign-in" className="mt-4 inline-block text-sm underline">
          Go to sign in
        </Link>
      ) : null}
      {error.code === "no_organisation" ? (
        <p className="mt-4 text-sm text-neutral-600">
          Use the organisation switcher in the top bar to pick or create one.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Server component wrapper: resolves the tenant (and optionally checks a permission),
 * then renders `children(ctx)`. Any `AuthError` becomes an `AuthErrorView`.
 */
export async function RequireOrg({
  action,
  children,
}: {
  action?: Action;
  children: (ctx: OrgContext) => ReactNode;
}) {
  let ctx: OrgContext;
  try {
    ctx = action ? await requireAction(action) : await requireOrg();
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  return <>{children(ctx)}</>;
}
