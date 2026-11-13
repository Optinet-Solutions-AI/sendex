"use client";

import { useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { REAUTH_CANCELLED, withoutReauthHint } from "./reauth-result";

type Refusal = { ok: false; error: string };
/** Any server action: `never[]` is the parameter list every function's parameters accept. */
type Action = (...args: never[]) => Promise<unknown>;
type Settled<A extends Action> = (
  ...args: Parameters<A>
) => Promise<Exclude<Awaited<ReturnType<A>>, { clerk_error: unknown }> | Refusal>;

/**
 * With Clerk: when the action answers with a reverification hint, Clerk asks for the
 * password in a dialog and runs the action again. Closing the dialog is a plain refusal.
 */
function useClerkReauthAction<A extends Action>(action: A): Settled<A> {
  // Clerk's hook wants a plain argument list; the action keeps its own types through `A`.
  const guarded = useReverification(action as unknown as (...args: unknown[]) => Promise<unknown>);
  return (async (...args: Parameters<A>) => {
    try {
      return withoutReauthHint(await guarded(...args));
    } catch (error) {
      if (isReverificationCancelledError(error)) return { ok: false, error: REAUTH_CANCELLED };
      throw error;
    }
  }) as Settled<A>;
}

/** Without Clerk (the development login) there is no prompt; a hint becomes a refusal. */
function usePlainReauthAction<A extends Action>(action: A): Settled<A> {
  return (async (...args: Parameters<A>) => withoutReauthHint(await action(...args))) as Settled<A>;
}

/**
 * Wrap a server action that needs a recent sign-in (D4-15): the user is asked for their
 * password in place instead of being told to sign out and in. The publishable key is fixed
 * at build time, so which of the two hooks this is never changes between renders; the
 * development login has no ClerkProvider, where Clerk's hook could not run.
 */
export const useReauthAction: <A extends Action>(action: A) => Settled<A> = process.env
  .NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? useClerkReauthAction
  : usePlainReauthAction;
