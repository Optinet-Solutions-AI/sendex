import { beforeEach, describe, expect, it, vi } from "vitest";

/** In-memory stand-in for the tenancy queries in `@sendex/db`. */
const store = vi.hoisted(() => {
  const users = new Map<string, { id: string; clerkUserId: string; email: string }>();
  const orgs = new Map<string, { id: string; clerkOrgId: string; name: string; slug: string }>();
  const memberships = new Map<string, { organisationId: string; userId: string; role: string }>();
  const calls = { db: 0, ensureUser: 0, ensureOrganisation: 0, upsertMembership: 0 };
  const key = (o: string, u: string) => `${o}:${u}`;
  return {
    users,
    orgs,
    memberships,
    calls,
    reset() {
      users.clear();
      orgs.clear();
      memberships.clear();
      for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = 0;
    },
    db: () => {
      calls.db += 1;
      return {};
    },
    ensureUser: async (_db: unknown, input: { clerkUserId: string; email: string }) => {
      calls.ensureUser += 1;
      const row = users.get(input.clerkUserId) ?? { id: `u_${input.clerkUserId}`, ...input };
      users.set(input.clerkUserId, { ...row, email: input.email });
      return row;
    },
    getOrganisationBySlug: async (_db: unknown, slug: string) =>
      [...orgs.values()].find((o) => o.slug === slug) ?? null,
    ensureOrganisation: async (
      _db: unknown,
      input: { clerkOrgId: string; name: string; slug: string },
    ) => {
      calls.ensureOrganisation += 1;
      const row = orgs.get(input.clerkOrgId) ?? { id: `o_${input.clerkOrgId}`, ...input };
      orgs.set(input.clerkOrgId, { ...row, name: input.name, slug: input.slug });
      return row;
    },
    upsertMembership: async (
      _db: unknown,
      input: { organisationId: string; userId: string; role: string },
    ) => {
      calls.upsertMembership += 1;
      memberships.set(key(input.organisationId, input.userId), input);
      return input;
    },
  };
});

vi.mock("@sendex/db", () => store);

import { devIdentifiers, devOrgContext } from "./dev-auth";

beforeEach(() => {
  store.reset();
});

describe("devIdentifiers", () => {
  it("derives stable fake Clerk ids from the slug", () => {
    expect(devIdentifiers("external")).toEqual({
      clerkUserId: "dev_user_external",
      clerkOrgId: "dev_org_external",
    });
  });
});

describe("devOrgContext", () => {
  it("seeds the user, organisation and membership and returns the context", async () => {
    const ctx = await devOrgContext({ orgSlug: "external", role: "owner" });
    expect(ctx).toEqual({
      userId: "u_dev_user_external",
      clerkUserId: "dev_user_external",
      organisationId: "o_dev_org_external",
      clerkOrgId: "dev_org_external",
      role: "owner",
    });
    expect(store.users.get("dev_user_external")?.email).toBe("dev-external@sendex.local");
    expect(store.orgs.get("dev_org_external")).toMatchObject({
      name: "External",
      slug: "external",
    });
    expect(store.memberships.get("o_dev_org_external:u_dev_user_external")?.role).toBe("owner");
    expect(store.calls.db).toBe(1);
  });

  it("uses the configured slug and role", async () => {
    const ctx = await devOrgContext({ orgSlug: "internal-ops", role: "viewer" });
    expect(ctx.clerkOrgId).toBe("dev_org_internal-ops");
    expect(ctx.role).toBe("viewer");
    expect(store.orgs.get("dev_org_internal-ops")?.name).toBe("Internal Ops");
    expect(store.memberships.get("o_dev_org_internal-ops:u_dev_user_internal-ops")?.role).toBe(
      "viewer",
    );
  });

  it("is idempotent: a second call reuses the rows and refreshes the role", async () => {
    const first = await devOrgContext({ orgSlug: "external", role: "owner" });
    const second = await devOrgContext({ orgSlug: "external", role: "campaign_manager" });
    expect(second.userId).toBe(first.userId);
    expect(second.organisationId).toBe(first.organisationId);
    expect(second.role).toBe("campaign_manager");
    expect(store.users.size).toBe(1);
    expect(store.orgs.size).toBe(1);
    expect(store.memberships.size).toBe(1);
    expect(store.calls.ensureUser).toBe(2);
    expect(store.calls.upsertMembership).toBe(2);
  });

  it("adopts an organisation that already owns the slug instead of creating a second one", async () => {
    // `pnpm db:seed` creates External with its own clerk id; the slug is unique, so the stub
    // must sign in to that row rather than insert dev_org_external alongside it.
    store.orgs.set("seed_org_external", {
      id: "o_seeded",
      clerkOrgId: "seed_org_external",
      name: "External",
      slug: "external",
    });
    const ctx = await devOrgContext({ orgSlug: "external", role: "owner" });
    expect(ctx.organisationId).toBe("o_seeded");
    expect(ctx.clerkOrgId).toBe("seed_org_external");
    expect(ctx.clerkUserId).toBe("dev_user_external");
    expect(store.orgs.size).toBe(1);
    expect(store.calls.ensureOrganisation).toBe(0);
    expect(store.memberships.get("o_seeded:u_dev_user_external")?.role).toBe("owner");
  });

  it("accepts an explicit database handle", async () => {
    const database = {} as never;
    await devOrgContext({ orgSlug: "external", role: "owner" }, database);
    expect(store.calls.db).toBe(0);
  });
});
