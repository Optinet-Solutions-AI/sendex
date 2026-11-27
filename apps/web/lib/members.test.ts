import { describe, expect, it } from "vitest";
import {
  blockOrganisationCreation,
  changeMemberRole,
  inviteMember,
  listMembers,
  type MembersClient,
  removeMember,
  revokeInvitation,
} from "./members";

const ORG = "org_emily";

function fakeClerk() {
  const calls: Array<[string, unknown]> = [];
  const members = [
    {
      role: "org:admin",
      createdAt: 1,
      publicUserData: {
        userId: "user_emily",
        identifier: "emily@example.com",
        firstName: "Emily",
        lastName: "P",
      },
    },
    {
      role: "org:member",
      createdAt: 2,
      publicUserData: {
        userId: "user_ana",
        identifier: "ana@example.com",
        firstName: null,
        lastName: null,
      },
    },
    {
      role: "org:viewer",
      createdAt: 3,
      publicUserData: {
        userId: "user_vi",
        identifier: "vi@example.com",
        firstName: "Vi",
        lastName: null,
      },
    },
  ];
  const client: MembersClient = {
    organizations: {
      getOrganizationMembershipList: async (p) => {
        calls.push(["memberships", p]);
        return { data: members, totalCount: members.length };
      },
      getOrganizationInvitationList: async (p) => {
        calls.push(["invitations", p]);
        return {
          data: [
            { id: "orginv_1", emailAddress: "new@example.com", role: "org:viewer", createdAt: 5 },
          ],
          totalCount: 1,
        };
      },
      createOrganizationInvitation: async (p) => {
        calls.push(["invite", p]);
        return { id: "orginv_2", emailAddress: p.emailAddress, role: p.role, createdAt: 6 };
      },
      updateOrganizationMembership: async (p) => {
        calls.push(["update", p]);
        return {};
      },
      deleteOrganizationMembership: async (p) => {
        calls.push(["delete", p]);
        return {};
      },
      revokeOrganizationInvitation: async (p) => {
        calls.push(["revoke", p]);
        return {};
      },
    },
    users: {
      updateUser: async (id, p) => {
        calls.push(["user", { id, ...p }]);
        return {};
      },
    },
  };
  return { client, calls };
}

describe("members through Clerk (D5-21)", () => {
  it("lists members with their Sendex role, and pending invitations", async () => {
    const { client } = fakeClerk();
    const list = await listMembers(client, ORG);
    expect(list.members).toEqual([
      { clerkUserId: "user_emily", name: "Emily P", email: "emily@example.com", role: "owner" },
      { clerkUserId: "user_ana", name: null, email: "ana@example.com", role: "campaign_manager" },
      { clerkUserId: "user_vi", name: "Vi", email: "vi@example.com", role: "viewer" },
    ]);
    expect(list.invitations).toEqual([
      { id: "orginv_1", email: "new@example.com", role: "viewer", sentAt: new Date(5) },
    ]);
  });

  it("invites with the Clerk role and sends the invitee to the sign-up page", async () => {
    const { client, calls } = fakeClerk();
    await inviteMember(client, ORG, {
      email: "danny@example.com",
      role: "campaign_manager",
      inviterClerkUserId: "user_emily",
      redirectUrl: "https://sendex.example/sign-up",
    });
    expect(calls).toContainEqual([
      "invite",
      {
        organizationId: ORG,
        emailAddress: "danny@example.com",
        role: "org:member",
        inviterUserId: "user_emily",
        redirectUrl: "https://sendex.example/sign-up",
      },
    ]);
  });

  it("refuses to change your own access or to leave no co-admin", async () => {
    const { client, calls } = fakeClerk();
    await expect(
      changeMemberRole(client, ORG, {
        actor: "user_emily",
        clerkUserId: "user_emily",
        role: "viewer",
      }),
    ).rejects.toThrow("You cannot change your own access");
    await expect(
      removeMember(client, ORG, { actor: "user_ana", clerkUserId: "user_emily" }),
    ).rejects.toThrow("at least one co-admin");
    expect(calls.filter(([name]) => name === "update" || name === "delete")).toEqual([]);
  });

  it("changes a role to co-admin and removes a member", async () => {
    const { client, calls } = fakeClerk();
    await changeMemberRole(client, ORG, {
      actor: "user_emily",
      clerkUserId: "user_ana",
      role: "owner",
    });
    await removeMember(client, ORG, { actor: "user_emily", clerkUserId: "user_vi" });
    expect(calls).toContainEqual([
      "update",
      { organizationId: ORG, userId: "user_ana", role: "org:admin" },
    ]);
    expect(calls).toContainEqual(["delete", { organizationId: ORG, userId: "user_vi" }]);
  });

  it("revokes an invitation and switches off creating organisations for a user", async () => {
    const { client, calls } = fakeClerk();
    await revokeInvitation(client, ORG, { actor: "user_emily", invitationId: "orginv_1" });
    await blockOrganisationCreation(client, "user_new");
    expect(calls).toContainEqual([
      "revoke",
      { organizationId: ORG, invitationId: "orginv_1", requestingUserId: "user_emily" },
    ]);
    expect(calls).toContainEqual(["user", { id: "user_new", createOrganizationEnabled: false }]);
  });
});
