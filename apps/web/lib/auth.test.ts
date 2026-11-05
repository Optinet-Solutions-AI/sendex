import { beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  getOrganization: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: clerk.auth,
  currentUser: clerk.currentUser,
  clerkClient: async () => ({ organizations: { getOrganization: clerk.getOrganization } }),
}));

/** In-memory stand-in for the tenancy queries in `@sendex/db`. */
const store = vi.hoisted(() => {
  const users = new Map<string, { id: string; clerkUserId: string; email: string }>();
  const orgs = new Map<string, { id: string; clerkOrgId: string; name: string; slug: string }>();
  const memberships = new Map<string, { organisationId: string; userId: string; role: string }>();
  const key = (o: string, u: string) => `${o}:${u}`;
  return {
    users,
    orgs,
    memberships,
    reset() {
      users.clear();
      orgs.clear();
      memberships.clear();
    },
    db: () => ({}),
    getUserByClerkId: async (_db: unknown, clerkUserId: string) => users.get(clerkUserId) ?? null,
    getOrganisationByClerkId: async (_db: unknown, clerkOrgId: string) =>
      orgs.get(clerkOrgId) ?? null,
    ensureUser: async (_db: unknown, input: { clerkUserId: string; email: string }) => {
      const row = { id: `u_${input.clerkUserId}`, ...input };
      users.set(input.clerkUserId, row);
      return row;
    },
    ensureOrganisation: async (
      _db: unknown,
      input: { clerkOrgId: string; name: string; slug: string },
    ) => {
      const row = { id: `o_${input.clerkOrgId}`, ...input };
      orgs.set(input.clerkOrgId, row);
      return row;
    },
    getMembership: async (_db: unknown, k: { organisationId: string; userId: string }) =>
      memberships.get(key(k.organisationId, k.userId)) ?? null,
    upsertMembership: async (
      _db: unknown,
      input: { organisationId: string; userId: string; role: string },
    ) => {
      memberships.set(key(input.organisationId, input.userId), input);
      return input;
    },
  };
});

vi.mock("@sendex/db", () => store);

import { AuthError, isAuthError, requireAction, requireOrg } from "./auth";

function signedIn(overrides: Record<string, unknown> = {}) {
  clerk.auth.mockResolvedValue({
    userId: "user_1",
    orgId: "org_1",
    orgRole: "org:admin",
    sessionId: "sess_1",
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.reset();
  clerk.currentUser.mockResolvedValue({
    primaryEmailAddressId: "em_1",
    emailAddresses: [
      { id: "em_0", emailAddress: "old@example.com" },
      { id: "em_1", emailAddress: "chris@example.com" },
    ],
    fullName: "Chris Example",
  });
  clerk.getOrganization.mockResolvedValue({ name: "External", slug: "external" });
});

describe("requireOrg", () => {
  it("throws 401 when there is no session", async () => {
    clerk.auth.mockResolvedValue({ userId: null, orgId: null, orgRole: null });
    const err = await requireOrg().catch((e: unknown) => e);
    expect(isAuthError(err)).toBe(true);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).status).toBe(401);
    expect((err as AuthError).code).toBe("unauthenticated");
  });

  it("throws 403 when there is a session but no active organisation", async () => {
    signedIn({ orgId: null, orgRole: null });
    const err = await requireOrg().catch((e: unknown) => e);
    expect((err as AuthError).status).toBe(403);
    expect((err as AuthError).code).toBe("no_organisation");
  });

  it("creates the local user, organisation and membership on first sight", async () => {
    signedIn();
    const ctx = await requireOrg();
    expect(ctx).toEqual({
      userId: "u_user_1",
      clerkUserId: "user_1",
      organisationId: "o_org_1",
      clerkOrgId: "org_1",
      role: "owner",
    });
    expect(store.users.get("user_1")?.email).toBe("chris@example.com");
    expect(store.orgs.get("org_1")?.slug).toBe("external");
    expect(store.memberships.get("o_org_1:u_user_1")?.role).toBe("owner");
    expect(clerk.currentUser).toHaveBeenCalledTimes(1);
    expect(clerk.getOrganization).toHaveBeenCalledWith({ organizationId: "org_1" });
  });

  it("does not call Clerk's API once the rows exist, but refreshes a changed role", async () => {
    store.users.set("user_1", { id: "u_user_1", clerkUserId: "user_1", email: "x@example.com" });
    store.orgs.set("org_1", { id: "o_org_1", clerkOrgId: "org_1", name: "External", slug: "ext" });
    store.memberships.set("o_org_1:u_user_1", {
      organisationId: "o_org_1",
      userId: "u_user_1",
      role: "owner",
    });
    signedIn({ orgRole: "org:member" });
    const ctx = await requireOrg();
    expect(ctx.role).toBe("campaign_manager");
    expect(store.memberships.get("o_org_1:u_user_1")?.role).toBe("campaign_manager");
    expect(clerk.currentUser).not.toHaveBeenCalled();
    expect(clerk.getOrganization).not.toHaveBeenCalled();
  });

  it("maps unknown Clerk roles to viewer", async () => {
    signedIn({ orgRole: "org:billing" });
    expect((await requireOrg()).role).toBe("viewer");
  });
});

describe("requireAction", () => {
  it("returns the context when the role may act", async () => {
    signedIn({ orgRole: "org:member" });
    const ctx = await requireAction("campaign.send");
    expect(ctx.role).toBe("campaign_manager");
  });

  it("throws 403 forbidden when the role may not act", async () => {
    signedIn({ orgRole: "org:member" });
    const err = await requireAction("balance.deposit").catch((e: unknown) => e);
    expect((err as AuthError).status).toBe(403);
    expect((err as AuthError).code).toBe("forbidden");
  });

  it("propagates 401 before checking permissions", async () => {
    clerk.auth.mockResolvedValue({ userId: null, orgId: null, orgRole: null });
    const err = await requireAction("campaign.view").catch((e: unknown) => e);
    expect((err as AuthError).status).toBe(401);
  });
});
