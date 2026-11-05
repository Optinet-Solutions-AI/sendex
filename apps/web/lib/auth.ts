import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { type Action, can, type Role } from "@sendex/core";
import {
  type Database,
  db,
  ensureOrganisation,
  ensureUser,
  getMembership,
  getOrganisationByClerkId,
  getUserByClerkId,
  upsertMembership,
} from "@sendex/db";
import { roleFromClerk } from "./clerk-roles";
import { devOrgContext } from "./dev-auth";
import { authMode } from "./env";

export type AuthErrorStatus = 401 | 403;
export type AuthErrorCode = "unauthenticated" | "no_organisation" | "forbidden" | "reauth_required";

/** Thrown by the tenancy helpers. Pages catch it and render a message; routes map it to a status. */
export class AuthError extends Error {
  readonly status: AuthErrorStatus;
  readonly code: AuthErrorCode;

  constructor(status: AuthErrorStatus, code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

/** The resolved tenant for the current request. Every db helper call takes `organisationId`. */
export interface OrgContext {
  /** Local `users.id`. */
  userId: string;
  clerkUserId: string;
  /** Local `organisations.id`. */
  organisationId: string;
  clerkOrgId: string;
  role: Role;
}

async function resolveUser(database: Database, clerkUserId: string) {
  const existing = await getUserByClerkId(database, clerkUserId);
  if (existing) return existing;
  // First request from this user before the webhook arrived: fetch their profile once.
  const user = await currentUser();
  if (!user) throw new AuthError(401, "unauthenticated", "Sign in to continue.");
  const primary =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  return ensureUser(database, {
    clerkUserId,
    email: primary?.emailAddress ?? "",
    name: user.fullName,
  });
}

async function resolveOrganisation(database: Database, clerkOrgId: string) {
  const existing = await getOrganisationByClerkId(database, clerkOrgId);
  if (existing) return existing;
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: clerkOrgId });
  return ensureOrganisation(database, { clerkOrgId, name: org.name, slug: org.slug });
}

/**
 * Resolve the signed-in user and their active organisation, creating the local rows on first
 * sight. Throws `AuthError` 401 without a session and 403 without an active organisation.
 *
 * In `authMode() === "dev"` (no Clerk keys, `SENDEX_DEV_AUTH=1`, never in production) the
 * seeded development user and organisation are returned instead; see `dev-auth.ts`.
 */
export async function requireOrg(): Promise<OrgContext> {
  if (authMode() === "dev") return devOrgContext();
  const session = await auth();
  if (!session.userId) {
    throw new AuthError(401, "unauthenticated", "Sign in to continue.");
  }
  if (!session.orgId) {
    throw new AuthError(403, "no_organisation", "Select or create an organisation to continue.");
  }
  const role = roleFromClerk(session.orgRole);
  const database = db();
  const user = await resolveUser(database, session.userId);
  const organisation = await resolveOrganisation(database, session.orgId);
  const membership = await getMembership(database, {
    organisationId: organisation.id,
    userId: user.id,
  });
  if (!membership || membership.role !== role) {
    // Clerk is the source of truth for membership; mirror the session's role locally.
    await upsertMembership(database, { organisationId: organisation.id, userId: user.id, role });
  }
  return {
    userId: user.id,
    clerkUserId: session.userId,
    organisationId: organisation.id,
    clerkOrgId: session.orgId,
    role,
  };
}

/** `requireOrg()` plus a permission check. Throws `AuthError` 403 when the role may not act. */
export async function requireAction(action: Action): Promise<OrgContext> {
  const ctx = await requireOrg();
  if (!can(ctx.role, action)) {
    throw new AuthError(403, "forbidden", `Your role (${ctx.role}) cannot ${action}.`);
  }
  return ctx;
}
