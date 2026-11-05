/** Environment variables Clerk needs before the app can authenticate anyone. */
export const CLERK_ENV_VARS = ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"] as const;

export type ClerkEnvVar = (typeof CLERK_ENV_VARS)[number];

/** Names of the Clerk variables that are unset or blank. Empty when Clerk is configured. */
export function missingClerkEnv(
  env: Record<string, string | undefined> = process.env,
): ClerkEnvVar[] {
  return CLERK_ENV_VARS.filter((name) => !env[name]?.trim());
}

export function isClerkConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return missingClerkEnv(env).length === 0;
}
