import { ROLES, type Role } from "@sendex/core";

/** Environment variables Clerk needs before the app can authenticate anyone. */
export const CLERK_ENV_VARS = ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"] as const;

export type ClerkEnvVar = (typeof CLERK_ENV_VARS)[number];

type Env = Record<string, string | undefined>;

/** Names of the Clerk variables that are unset or blank. Empty when Clerk is configured. */
export function missingClerkEnv(env: Env = process.env): ClerkEnvVar[] {
  return CLERK_ENV_VARS.filter((name) => !env[name]?.trim());
}

export function isClerkConfigured(env: Env = process.env): boolean {
  return missingClerkEnv(env).length === 0;
}

/**
 * How requests are authenticated.
 *
 * - `clerk`: both Clerk keys are set. Always wins over the stub.
 * - `dev`: no Clerk keys, `SENDEX_DEV_AUTH=1` and `NODE_ENV` is not `production`. Every
 *   request is treated as a fixed seeded user (see `devAuthConfig`). Never possible in
 *   production builds, whatever the flag says.
 * - `unconfigured`: neither; the root layout renders the setup page.
 */
export type AuthMode = "clerk" | "dev" | "unconfigured";

export function authMode(env: Env = process.env): AuthMode {
  if (isClerkConfigured(env)) return "clerk";
  if (env.NODE_ENV !== "production" && env.SENDEX_DEV_AUTH === "1") return "dev";
  return "unconfigured";
}

export const DEV_AUTH_DEFAULTS = { orgSlug: "external", role: "owner" } as const;

/** Lower-case letters, digits and single hyphens: safe inside `dev_org_<slug>` identifiers. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface DevAuthConfig {
  orgSlug: string;
  role: Role;
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Which organisation and role the development stub signs in as. Read from
 * `SENDEX_DEV_ORG_SLUG` and `SENDEX_DEV_ROLE`; blank values fall back to the defaults.
 * Throws on values that are not a valid slug or role so a typo fails loudly.
 */
export function devAuthConfig(env: Env = process.env): DevAuthConfig {
  const orgSlug = env.SENDEX_DEV_ORG_SLUG?.trim() || DEV_AUTH_DEFAULTS.orgSlug;
  if (!SLUG_PATTERN.test(orgSlug)) {
    throw new Error(
      `SENDEX_DEV_ORG_SLUG must be a slug (lower-case letters, digits, hyphens), got "${orgSlug}".`,
    );
  }
  const role = env.SENDEX_DEV_ROLE?.trim() || DEV_AUTH_DEFAULTS.role;
  if (!isRole(role)) {
    throw new Error(`SENDEX_DEV_ROLE "${role}" is not a role; use one of ${ROLES.join(", ")}.`);
  }
  return { orgSlug, role };
}
