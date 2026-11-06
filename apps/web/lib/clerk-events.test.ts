import { beforeEach, describe, expect, it } from "vitest";
import { applyClerkEvent, type ClerkEventDeps } from "./clerk-events";

type UserRow = { id: string; clerkUserId: string; email: string; name: string | null };
type OrgRow = { id: string; clerkOrgId: string; name: string; slug: string };
type MembershipRow = { organisationId: string; userId: string; role: string };

function fakeDeps() {
  const users = new Map<string, UserRow>();
  const orgs = new Map<string, OrgRow>();
  const memberships = new Map<string, MembershipRow>();
  const key = (o: string, u: string) => `${o}:${u}`;
  const deps: ClerkEventDeps = {
    async ensureUser(input) {
      const row = {
        id: users.get(input.clerkUserId)?.id ?? `u_${input.clerkUserId}`,
        clerkUserId: input.clerkUserId,
        email: input.email,
        name: input.name ?? null,
      };
      users.set(input.clerkUserId, row);
      return row;
    },
    async ensureOrganisation(input) {
      const row = { id: orgs.get(input.clerkOrgId)?.id ?? `o_${input.clerkOrgId}`, ...input };
      orgs.set(input.clerkOrgId, row);
      return row;
    },
    async getUserByClerkId(id) {
      return users.get(id) ?? null;
    },
    async getOrganisationByClerkId(id) {
      return orgs.get(id) ?? null;
    },
    async upsertMembership(input) {
      memberships.set(key(input.organisationId, input.userId), input);
      return input;
    },
    async removeMembership(k) {
      return memberships.delete(key(k.organisationId, k.userId));
    },
  };
  return { deps, users, orgs, memberships };
}

const membershipPayload = (role: string) => ({
  id: "orgmem_1",
  role,
  organization: { id: "org_1", name: "External", slug: "external" },
  public_user_data: {
    user_id: "user_1",
    identifier: "chris@example.com",
    first_name: "Chris",
    last_name: "Example",
  },
});

let fake: ReturnType<typeof fakeDeps>;
beforeEach(() => {
  fake = fakeDeps();
});

describe("applyClerkEvent: users", () => {
  it("user.created upserts the user with the primary email and full name", async () => {
    const result = await applyClerkEvent(
      {
        type: "user.created",
        data: {
          id: "user_1",
          primary_email_address_id: "em_2",
          email_addresses: [
            { id: "em_1", email_address: "alt@example.com" },
            { id: "em_2", email_address: "chris@example.com" },
          ],
          first_name: "Chris",
          last_name: "Example",
        },
      },
      fake.deps,
    );
    expect(result.handled).toBe(true);
    expect(fake.users.get("user_1")).toEqual({
      id: "u_user_1",
      clerkUserId: "user_1",
      email: "chris@example.com",
      name: "Chris Example",
    });
  });

  it("user.updated falls back to the first email and a null name", async () => {
    await applyClerkEvent(
      {
        type: "user.updated",
        data: {
          id: "user_1",
          primary_email_address_id: null,
          email_addresses: [{ id: "em_1", email_address: "only@example.com" }],
          first_name: null,
          last_name: "",
        },
      },
      fake.deps,
    );
    expect(fake.users.get("user_1")?.email).toBe("only@example.com");
    expect(fake.users.get("user_1")?.name).toBeNull();
  });

  it("skips a user with no email address", async () => {
    const result = await applyClerkEvent(
      { type: "user.created", data: { id: "user_2", email_addresses: [] } },
      fake.deps,
    );
    expect(result).toEqual({
      handled: false,
      type: "user.created",
      reason: "user has no email address",
    });
    expect(fake.users.size).toBe(0);
  });

  it("rejects a malformed payload without touching the store", async () => {
    const result = await applyClerkEvent({ type: "user.created", data: { nope: 1 } }, fake.deps);
    expect(result.handled).toBe(false);
    expect(fake.users.size).toBe(0);
  });
});

describe("applyClerkEvent: organisations", () => {
  it("organization.created and updated upsert the organisation", async () => {
    await applyClerkEvent(
      { type: "organization.created", data: { id: "org_1", name: "External", slug: "external" } },
      fake.deps,
    );
    expect(fake.orgs.get("org_1")).toEqual({
      id: "o_org_1",
      clerkOrgId: "org_1",
      name: "External",
      slug: "external",
    });
    await applyClerkEvent(
      { type: "organization.updated", data: { id: "org_1", name: "External Ltd", slug: "ext" } },
      fake.deps,
    );
    expect(fake.orgs.get("org_1")).toMatchObject({
      id: "o_org_1",
      name: "External Ltd",
      slug: "ext",
    });
  });

  it("uses the Clerk id as slug when Clerk sends none", async () => {
    await applyClerkEvent(
      { type: "organization.created", data: { id: "org_9", name: "Internal", slug: null } },
      fake.deps,
    );
    expect(fake.orgs.get("org_9")?.slug).toBe("org_9");
  });
});

describe("applyClerkEvent: memberships", () => {
  it.each([
    ["org:admin", "owner"],
    ["org:member", "campaign_manager"],
    ["org:billing", "viewer"],
    ["", "viewer"],
  ])("maps Clerk role %s to %s", async (clerkRole, expected) => {
    const result = await applyClerkEvent(
      { type: "organizationMembership.created", data: membershipPayload(clerkRole) },
      fake.deps,
    );
    expect(result.handled).toBe(true);
    expect(fake.memberships.get("o_org_1:u_user_1")?.role).toBe(expected);
  });

  it("creates the organisation and user rows if the webhook arrives out of order", async () => {
    await applyClerkEvent(
      { type: "organizationMembership.created", data: membershipPayload("org:member") },
      fake.deps,
    );
    expect(fake.orgs.get("org_1")?.name).toBe("External");
    expect(fake.users.get("user_1")).toMatchObject({
      email: "chris@example.com",
      name: "Chris Example",
    });
  });

  it("organizationMembership.updated changes the role of an existing membership", async () => {
    await applyClerkEvent(
      { type: "organizationMembership.created", data: membershipPayload("org:admin") },
      fake.deps,
    );
    await applyClerkEvent(
      { type: "organizationMembership.updated", data: membershipPayload("org:member") },
      fake.deps,
    );
    expect(fake.memberships.size).toBe(1);
    expect(fake.memberships.get("o_org_1:u_user_1")?.role).toBe("campaign_manager");
  });

  it("organizationMembership.deleted removes the membership and keeps the user", async () => {
    await applyClerkEvent(
      { type: "organizationMembership.created", data: membershipPayload("org:admin") },
      fake.deps,
    );
    const result = await applyClerkEvent(
      { type: "organizationMembership.deleted", data: membershipPayload("org:admin") },
      fake.deps,
    );
    expect(result).toMatchObject({ handled: true });
    expect(fake.memberships.size).toBe(0);
    expect(fake.users.has("user_1")).toBe(true);
  });

  it("organizationMembership.deleted is a no-op for unknown rows", async () => {
    const result = await applyClerkEvent(
      { type: "organizationMembership.deleted", data: membershipPayload("org:admin") },
      fake.deps,
    );
    expect(result).toEqual({
      handled: true,
      type: "organizationMembership.deleted",
      summary: "membership already absent",
    });
  });
});

describe("applyClerkEvent: other events", () => {
  it("ignores event types it does not know", async () => {
    const result = await applyClerkEvent({ type: "session.created", data: {} }, fake.deps);
    expect(result).toEqual({
      handled: false,
      type: "session.created",
      reason: "event type not handled",
    });
  });
});
