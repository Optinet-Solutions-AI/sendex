import { auth, clerkClient, reverificationError } from "@clerk/nextjs/server";
import { AuthError } from "./auth";
import { authMode } from "./env";

export const DEFAULT_REAUTH_MAX_AGE_SECONDS = 300;

export interface RecentAuthInput {
  nowMs: number;
  maxAgeSeconds: number;
  /**
   * Minutes since the first factor (password, passkey, OTP) was verified, from the session
   * token's `fva` claim. Clerk refreshes it when the user re-enters their password.
   */
  factorVerificationAgeMinutes?: number | null;
  /** Unix ms when the session was created, from the Backend API `Session.createdAt`. */
  sessionCreatedAtMs?: number | null;
}

/**
 * Pure decision: did the user prove who they are within `maxAgeSeconds`?
 *
 * Either signal is enough. `lastActiveAt` is deliberately not used: it is bumped by any
 * request, so an attacker holding a stolen session would always look "recent".
 */
export function isRecentAuth(input: RecentAuthInput): boolean {
  const maxMs = input.maxAgeSeconds * 1000;
  const fva = input.factorVerificationAgeMinutes;
  if (typeof fva === "number" && fva >= 0 && fva * 60_000 <= maxMs) return true;
  const created = input.sessionCreatedAtMs;
  if (typeof created === "number" && input.nowMs - created <= maxMs) return true;
  return false;
}

/**
 * Guard for sensitive actions (deposit, flush, emergency stop): the user must have signed in
 * or re-verified their first factor within `maxAgeSeconds`. Throws `AuthError` 401 without a
 * session and 403 `reauth_required` when the proof is stale. Server actions behind a form
 * use `requireRecentAuth` instead, which lets Clerk prompt for the password (D4-15).
 *
 * Under the development auth stub there is no Clerk session to check, so it passes.
 */
export async function assertRecentAuth(
  maxAgeSeconds = DEFAULT_REAUTH_MAX_AGE_SECONDS,
): Promise<void> {
  if (authMode() === "dev") return;
  const session = await auth();
  if (!session.userId || !session.sessionId) {
    throw new AuthError(401, "unauthenticated", "Sign in to continue.");
  }
  const fva = session.factorVerificationAge?.[0] ?? null;
  if (isRecentAuth({ nowMs: Date.now(), maxAgeSeconds, factorVerificationAgeMinutes: fva })) {
    return;
  }
  const client = await clerkClient();
  const record = await client.sessions.getSession(session.sessionId);
  if (
    isRecentAuth({
      nowMs: Date.now(),
      maxAgeSeconds,
      factorVerificationAgeMinutes: fva,
      sessionCreatedAtMs: record.createdAt,
    })
  ) {
    return;
  }
  throw new AuthError(
    403,
    "reauth_required",
    `Please confirm your password again; this action needs a sign-in within the last ${maxAgeSeconds} seconds.`,
  );
}

/** What Clerk's `useReverification` looks for in a server action's result. */
export type ReauthHint = ReturnType<typeof reverificationError>;

/**
 * Null when the sign-in is recent enough. When it is stale: Clerk's reverification hint,
 * asking for the first factor (the password) again within the same window, rounded up to
 * whole minutes. Returned from a server action, it makes `useReauthAction` on the client
 * show Clerk's password dialog and run the action again (D4-15). Still throws 401 without
 * a session.
 */
export async function reauthHint(
  maxAgeSeconds = DEFAULT_REAUTH_MAX_AGE_SECONDS,
): Promise<ReauthHint | null> {
  try {
    await assertRecentAuth(maxAgeSeconds);
    return null;
  } catch (error) {
    if (error instanceof AuthError && error.code === "reauth_required") {
      return reverificationError({
        level: "first_factor",
        afterMinutes: Math.max(1, Math.ceil(maxAgeSeconds / 60)),
      });
    }
    throw error;
  }
}

/** Carries the hint out of an action body to the wrapper that returns it. */
export class ReauthRequired extends Error {
  constructor(readonly hint: ReauthHint) {
    super("reauth required");
    this.name = "ReauthRequired";
  }
}

/**
 * `assertRecentAuth` for server actions called through `useReauthAction`: throws
 * `ReauthRequired` with Clerk's hint when the sign-in is stale; the action's wrapper
 * returns the hint as its result.
 */
export async function requireRecentAuth(
  maxAgeSeconds = DEFAULT_REAUTH_MAX_AGE_SECONDS,
): Promise<void> {
  const hint = await reauthHint(maxAgeSeconds);
  if (hint !== null) throw new ReauthRequired(hint);
}
