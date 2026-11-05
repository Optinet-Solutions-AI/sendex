import { auth, clerkClient } from "@clerk/nextjs/server";
import { AuthError } from "./auth";

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
 * session and 403 `reauth_required` when the proof is stale; the caller then asks Clerk's
 * `useReverification()` on the client to re-prompt and retries.
 */
export async function assertRecentAuth(
  maxAgeSeconds = DEFAULT_REAUTH_MAX_AGE_SECONDS,
): Promise<void> {
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
