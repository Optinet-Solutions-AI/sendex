/**
 * Client-safe helpers for actions that need a recent sign-in (D4-15). A server action
 * returns Clerk's reverification hint when the sign-in is stale; `useReauthAction` lets
 * Clerk prompt for the password and retries. Where no prompt is available these turn the
 * hint into an ordinary refusal, so a form never has to know the hint's shape.
 */

export const REAUTH_NEEDED =
  "Please confirm your password to continue. If no prompt appears, sign out and sign in again, then retry within 5 minutes.";

export const REAUTH_CANCELLED = "Password not confirmed, so nothing was changed.";

/** Whether an action result is Clerk's reverification hint (`reverificationError()`). */
export function isReauthHint(result: unknown): boolean {
  if (result === null || typeof result !== "object") return false;
  const error = (result as { clerk_error?: unknown }).clerk_error;
  if (error === null || typeof error !== "object") return false;
  return (error as { reason?: unknown }).reason === "reverification-error";
}

/** A hint becomes `{ ok: false, error }`; any other result is returned as it is. */
export function withoutReauthHint<T>(result: T): T | { ok: false; error: string } {
  return isReauthHint(result) ? { ok: false, error: REAUTH_NEEDED } : result;
}
