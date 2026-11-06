import type { DevAuthConfig } from "../../lib/env";

/**
 * Shown in the top bar instead of Clerk's organisation switcher and user menu when the
 * development auth stub is active, so nobody mistakes a stubbed session for a real one.
 */
export function DevAuthBanner({ config }: { config: DevAuthConfig }) {
  return (
    <output
      data-testid="dev-auth-banner"
      className="block w-full rounded border border-amber-300 bg-amber-100 px-3 py-1.5 text-sm text-amber-900"
    >
      <span className="font-medium">Development login:</span> {config.orgSlug} as {config.role}
      <span className="ml-2 text-xs text-amber-700">
        (SENDEX_DEV_AUTH=1, no Clerk; never active in production)
      </span>
    </output>
  );
}
