import { describe, expect, it } from "vitest";
import { isReauthHint, REAUTH_NEEDED, withoutReauthHint } from "./reauth-result";

// D4-15: what a form does with an action result when no password prompt is available.
describe("reauth results", () => {
  const hint = { clerk_error: { type: "forbidden", reason: "reverification-error" } };

  it("recognises Clerk's reverification hint and nothing else", () => {
    expect(isReauthHint(hint)).toBe(true);
    expect(isReauthHint({ ok: true, data: 1 })).toBe(false);
    expect(isReauthHint({ clerk_error: { reason: "something-else" } })).toBe(false);
    expect(isReauthHint(null)).toBe(false);
    expect(isReauthHint("nope")).toBe(false);
  });

  it("turns a hint into a plain refusal and leaves other results alone", () => {
    expect(withoutReauthHint(hint)).toEqual({ ok: false, error: REAUTH_NEEDED });
    const ok = { ok: true as const, data: { id: "1" } };
    expect(withoutReauthHint(ok)).toBe(ok);
  });
});
