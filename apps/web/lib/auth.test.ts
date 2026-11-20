import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** The request's cookies: the Existing / New choice is read from them (D5-11). */
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  }),
}));

/** In-memory stand-in for the tenancy queries in `@sendex/db`. */
const store = vi.hoisted(() => {
  const users = new Map<string, { id: string; clerkUserId: string; email: string }>();
  const orgs = new Map<
    string,
    {
      id: string;
      clerkOrgId: string;
      name: string;
      slug: string;
      previewFeatures?: boolean;
      previewToggle?: boolean;
    }
  >();
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
      store.tenantLookups = 0;
      store.writes = 0;
    },
    writes: 0,
    db: () => ({}),
    /** Counts the one-query fast path so the tests can assert how much a request costs. */
    tenantLookups: 0,
    getTenantByClerkIds: async (_db: unknown, ids: { clerkUserId: string; clerkOrgId: string }) => {
      store.tenantLookups += 1;
      const user = users.get(ids.clerkUserId);
      const organisation = orgs.get(ids.clerkOrgId);
      if (!user || !organisation) return null;
      const membership = memberships.get(key(organisation.id, user.id));
      return { user, organisation, membershipRole: membership?.role ?? null };
    },
    getUserByClerkId: async (_db: unknown, clerkUserId: string) => users.get(clerkUserId) ?? null,
    getOrganisationByClerkId: async (_db: unknown, clerkOrgId: string) =>
      orgs.get(clerkOrgId) ?? null,
    getOrganisationBySlug: async (_db: unknown, slug: string) =>
      [...orgs.values()].find((o) => o.slug === slug) ?? null,
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
      store.writes += 1;
      memberships.set(key(input.organisationId, input.userId), input);
      return input;
    },
  };
});

vi.mock("@sendex/db", () => store);

import { AuthError, isAuthError, requireAction, requireOrg, requirePreviewAction } from "./auth";

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
  jar.clear();
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("development auth stub", () => {
  it("signs every request in as the seeded owner when SENDEX_DEV_AUTH=1 outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SENDEX_DEV_AUTH", "1");
    vi.stubEnv("SENDEX_DEV_ORG_SLUG", "");
    vi.stubEnv("SENDEX_DEV_ROLE", "");
    const ctx = await requireOrg();
    expect(ctx).toEqual({
      userId: "u_dev_user_external",
      clerkUserId: "dev_user_external",
      organisationId: "o_dev_org_external",
      clerkOrgId: "dev_org_external",
      role: "owner",
      previewFeatures: false,
      previewView: null,
    });
    expect(store.orgs.get("dev_org_external")?.slug).toBe("external");
    expect(store.memberships.get("o_dev_org_external:u_dev_user_external")?.role).toBe("owner");
    expect(clerk.auth).not.toHaveBeenCalled();
    expect(clerk.currentUser).not.toHaveBeenCalled();
    expect(clerk.getOrganization).not.toHaveBeenCalled();
  });

  it("honours SENDEX_DEV_ROLE so requireAction can be exercised per role", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SENDEX_DEV_AUTH", "1");
    vi.stubEnv("SENDEX_DEV_ROLE", "viewer");
    const err = await requireAction("campaign.send").catch((e: unknown) => e);
    expect((err as AuthError).code).toBe("forbidden");
    expect(clerk.auth).not.toHaveBeenCalled();
  });

  it("is ignored in production: SENDEX_DEV_AUTH=1 still goes through Clerk", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENDEX_DEV_AUTH", "1");
    clerk.auth.mockResolvedValue({ userId: null, orgId: null, orgRole: null });
    const err = await requireOrg().catch((e: unknown) => e);
    expect((err as AuthError).status).toBe(401);
    expect(clerk.auth).toHaveBeenCalledTimes(1);
    expect(store.users.has("dev_user_external")).toBe(false);
    expect(store.orgs.has("dev_org_external")).toBe(false);
  });

  it("is ignored when Clerk keys are present, even outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SENDEX_DEV_AUTH", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_y");
    signedIn();
    const ctx = await requireOrg();
    expect(ctx.clerkUserId).toBe("user_1");
    expect(clerk.auth).toHaveBeenCalledTimes(1);
    expect(store.users.has("dev_user_external")).toBe(false);
  });
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
      previewFeatures: false,
      previewView: null,
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

  it("costs a returning member one lookup and no write", async () => {
    store.users.set("user_1", { id: "u_user_1", clerkUserId: "user_1", email: "x@example.com" });
    store.orgs.set("org_1", { id: "o_org_1", clerkOrgId: "org_1", name: "External", slug: "ext" });
    store.memberships.set("o_org_1:u_user_1", {
      organisationId: "o_org_1",
      userId: "u_user_1",
      role: "owner",
    });
    signedIn();
    const ctx = await requireOrg();
    expect(ctx.organisationId).toBe("o_org_1");
    expect(store.tenantLookups).toBe(1);
    expect(store.writes).toBe(0);
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

describe("preview features (D5-09)", () => {
  it("refuses a preview feature when the organisation does not have the preview on", async () => {
    signedIn();
    const ctx = await requireAction("campaign.view");
    expect(ctx.previewFeatures).toBe(false);
    const err = await requirePreviewAction("campaign.view").catch((e: unknown) => e);
    expect(isAuthError(err)).toBe(true);
    expect((err as AuthError).status).toBe(403);
    expect((err as AuthError).message).toBe(
      "This feature is not switched on for your organisation.",
    );
  });

  it("lets it through once the organisation has the preview on", async () => {
    signedIn();
    await requireOrg();
    const org = store.orgs.get("org_1");
    if (!org) throw new Error("the organisation was not created");
    store.orgs.set("org_1", { ...org, previewFeatures: true });
    const ctx = await requirePreviewAction("campaign.view");
    expect(ctx.previewFeatures).toBe(true);
  });
});

describe("Existing / New switch (D5-11)", () => {
  async function toggleOrg() {
    signedIn();
    await requireOrg();
    const org = store.orgs.get("org_1");
    if (!org) throw new Error("the organisation was not created");
    store.orgs.set("org_1", { ...org, previewToggle: true });
    return org.id;
  }

  it("starts on Existing: the switch is offered, the preview stays hidden", async () => {
    await toggleOrg();
    const ctx = await requireOrg();
    expect(ctx.previewView).toBe("existing");
    expect(ctx.previewFeatures).toBe(false);
    const err = await requirePreviewAction("campaign.view").catch((e: unknown) => e);
    expect((err as AuthError).status).toBe(403);
  });

  it("shows the preview once this person picked New for this organisation", async () => {
    const organisationId = await toggleOrg();
    jar.set(`sendex-view-${organisationId}`, "new");
    const ctx = await requirePreviewAction("campaign.view");
    expect(ctx.previewView).toBe("new");
    expect(ctx.previewFeatures).toBe(true);
  });

  it("ignores a choice made for another organisation", async () => {
    await toggleOrg();
    jar.set("sendex-view-some-other-organisation", "new");
    expect((await requireOrg()).previewFeatures).toBe(false);
  });

  it("offers no switch to an organisation without it, whatever the cookie says", async () => {
    signedIn();
    const first = await requireOrg();
    jar.set(`sendex-view-${first.organisationId}`, "new");
    const ctx = await requireOrg();
    expect(ctx.previewView).toBeNull();
    expect(ctx.previewFeatures).toBe(false);
  });
});
