import { beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ auth: vi.fn(), getSession: vi.fn() }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: clerk.auth,
  clerkClient: async () => ({ sessions: { getSession: clerk.getSession } }),
}));

vi.mock("@sendex/db", () => ({}));

import { AuthError } from "./auth";
import { assertRecentAuth, isRecentAuth } from "./reauth";

const NOW = 1_700_000_000_000;

describe("isRecentAuth", () => {
  it("accepts a first factor verified within the window", () => {
    expect(isRecentAuth({ nowMs: NOW, maxAgeSeconds: 300, factorVerificationAgeMinutes: 4 })).toBe(
      true,
    );
    expect(isRecentAuth({ nowMs: NOW, maxAgeSeconds: 300, factorVerificationAgeMinutes: 5 })).toBe(
      true,
    );
  });

  it("rejects a first factor older than the window", () => {
    expect(isRecentAuth({ nowMs: NOW, maxAgeSeconds: 300, factorVerificationAgeMinutes: 6 })).toBe(
      false,
    );
  });

  it("ignores a negative factor age (Clerk uses -1 for 'not verified')", () => {
    expect(isRecentAuth({ nowMs: NOW, maxAgeSeconds: 300, factorVerificationAgeMinutes: -1 })).toBe(
      false,
    );
  });

  it("accepts a session created within the window", () => {
    expect(
      isRecentAuth({ nowMs: NOW, maxAgeSeconds: 300, sessionCreatedAtMs: NOW - 299_000 }),
    ).toBe(true);
    expect(
      isRecentAuth({ nowMs: NOW, maxAgeSeconds: 300, sessionCreatedAtMs: NOW - 301_000 }),
    ).toBe(false);
  });

  it("is false with no signal at all", () => {
    expect(isRecentAuth({ nowMs: NOW, maxAgeSeconds: 300 })).toBe(false);
    expect(
      isRecentAuth({
        nowMs: NOW,
        maxAgeSeconds: 300,
        factorVerificationAgeMinutes: null,
        sessionCreatedAtMs: null,
      }),
    ).toBe(false);
  });
});

describe("assertRecentAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("passes without touching Clerk under the development auth stub", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SENDEX_DEV_AUTH", "1");
    await expect(assertRecentAuth()).resolves.toBeUndefined();
    expect(clerk.auth).not.toHaveBeenCalled();
    expect(clerk.getSession).not.toHaveBeenCalled();
  });

  it("still asks Clerk in production even with SENDEX_DEV_AUTH=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENDEX_DEV_AUTH", "1");
    clerk.auth.mockResolvedValue({ userId: null, sessionId: null, factorVerificationAge: null });
    const err = await assertRecentAuth().catch((e: unknown) => e);
    expect((err as AuthError).status).toBe(401);
    expect(clerk.auth).toHaveBeenCalledTimes(1);
  });

  it("throws 401 without a session", async () => {
    clerk.auth.mockResolvedValue({ userId: null, sessionId: null, factorVerificationAge: null });
    const err = await assertRecentAuth().catch((e: unknown) => e);
    expect((err as AuthError).status).toBe(401);
    expect(clerk.getSession).not.toHaveBeenCalled();
  });

  it("passes on a fresh factor verification without calling the Backend API", async () => {
    clerk.auth.mockResolvedValue({
      userId: "user_1",
      sessionId: "sess_1",
      factorVerificationAge: [1, -1],
    });
    await expect(assertRecentAuth()).resolves.toBeUndefined();
    expect(clerk.getSession).not.toHaveBeenCalled();
  });

  it("falls back to the session creation time", async () => {
    clerk.auth.mockResolvedValue({
      userId: "user_1",
      sessionId: "sess_1",
      factorVerificationAge: [60, -1],
    });
    clerk.getSession.mockResolvedValue({ createdAt: Date.now() - 60_000 });
    await expect(assertRecentAuth(120)).resolves.toBeUndefined();
    expect(clerk.getSession).toHaveBeenCalledWith("sess_1");
  });

  it("throws 403 reauth_required when both signals are stale", async () => {
    clerk.auth.mockResolvedValue({
      userId: "user_1",
      sessionId: "sess_1",
      factorVerificationAge: [60, -1],
    });
    clerk.getSession.mockResolvedValue({ createdAt: Date.now() - 3_600_000 });
    const err = await assertRecentAuth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).status).toBe(403);
    expect((err as AuthError).code).toBe("reauth_required");
  });
});
