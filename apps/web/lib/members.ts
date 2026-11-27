import { clerkRoleFor, memberChangeProblem, type Role } from "@sendex/core";
import { roleFromClerk } from "./clerk-roles";

/**
 * Members of an organisation through Clerk (D5-21). Clerk holds memberships and invitations;
 * this module lists and changes them for the Members screen. It takes the Clerk backend
 * client as an argument (the subset below) so it can be tested with a fake.
 */

interface ClerkMembership {
  role: string;
  createdAt: number;
  publicUserData?:
    | {
        userId: string;
        identifier: string;
        firstName: string | null;
        lastName: string | null;
      }
    | null
    | undefined;
}

interface ClerkInvitation {
  id: string;
  emailAddress: string;
  role: string;
  createdAt: number;
}

export interface MembersClient {
  organizations: {
    getOrganizationMembershipList(params: {
      organizationId: string;
      limit?: number;
    }): Promise<{ data: ClerkMembership[]; totalCount: number }>;
    getOrganizationInvitationList(params: {
      organizationId: string;
      status?: ("pending" | "accepted" | "revoked" | "expired")[];
      limit?: number;
    }): Promise<{ data: ClerkInvitation[]; totalCount: number }>;
    createOrganizationInvitation(params: {
      organizationId: string;
      emailAddress: string;
      role: string;
      inviterUserId?: string;
      redirectUrl?: string;
    }): Promise<ClerkInvitation>;
    updateOrganizationMembership(params: {
      organizationId: string;
      userId: string;
      role: string;
    }): Promise<unknown>;
    deleteOrganizationMembership(params: {
      organizationId: string;
      userId: string;
    }): Promise<unknown>;
    revokeOrganizationInvitation(params: {
      organizationId: string;
      invitationId: string;
      requestingUserId?: string;
    }): Promise<unknown>;
  };
  users: {
    updateUser(userId: string, params: { createOrganizationEnabled?: boolean }): Promise<unknown>;
  };
}

export interface MemberView {
  clerkUserId: string;
  name: string | null;
  email: string;
  role: Role;
}

export interface InvitationView {
  id: string;
  email: string;
  role: Role;
  sentAt: Date;
}

/** Members (oldest first) and the invitations still waiting for an answer. */
export async function listMembers(
  client: MembersClient,
  clerkOrgId: string,
): Promise<{ members: MemberView[]; invitations: InvitationView[] }> {
  const [memberships, invitations] = await Promise.all([
    client.organizations.getOrganizationMembershipList({ organizationId: clerkOrgId, limit: 100 }),
    client.organizations.getOrganizationInvitationList({
      organizationId: clerkOrgId,
      status: ["pending"],
      limit: 100,
    }),
  ]);
  const members = [...memberships.data]
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((m): MemberView[] => {
      const who = m.publicUserData;
      if (!who) return [];
      const name = [who.firstName, who.lastName].filter((p) => p?.trim()).join(" ");
      return [
        {
          clerkUserId: who.userId,
          name: name === "" ? null : name,
          email: who.identifier,
          role: roleFromClerk(m.role),
        },
      ];
    });
  return {
    members,
    invitations: invitations.data.map((i) => ({
      id: i.id,
      email: i.emailAddress,
      role: roleFromClerk(i.role),
      sentAt: new Date(i.createdAt),
    })),
  };
}

export async function inviteMember(
  client: MembersClient,
  clerkOrgId: string,
  input: { email: string; role: Role; inviterClerkUserId: string; redirectUrl: string },
): Promise<void> {
  await client.organizations.createOrganizationInvitation({
    organizationId: clerkOrgId,
    emailAddress: input.email,
    role: clerkRoleFor(input.role),
    inviterUserId: input.inviterClerkUserId,
    redirectUrl: input.redirectUrl,
  });
}

/** The member's current role and the organisation's co-admins, for the safety rules. */
async function current(client: MembersClient, clerkOrgId: string, clerkUserId: string) {
  const { members } = await listMembers(client, clerkOrgId);
  const target = members.find((m) => m.clerkUserId === clerkUserId);
  if (!target) throw new Error("This person is not a member of the organisation.");
  const admins = members.filter((m) => m.role === "owner").map((m) => m.clerkUserId);
  return { target, admins };
}

export async function changeMemberRole(
  client: MembersClient,
  clerkOrgId: string,
  input: { actor: string; clerkUserId: string; role: Role },
): Promise<{ from: Role; to: Role }> {
  const { target, admins } = await current(client, clerkOrgId, input.clerkUserId);
  const problem = memberChangeProblem({
    actor: input.actor,
    target: input.clerkUserId,
    targetRole: target.role,
    change: { role: input.role },
    admins,
  });
  if (problem) throw new Error(problem);
  await client.organizations.updateOrganizationMembership({
    organizationId: clerkOrgId,
    userId: input.clerkUserId,
    role: clerkRoleFor(input.role),
  });
  return { from: target.role, to: input.role };
}

export async function removeMember(
  client: MembersClient,
  clerkOrgId: string,
  input: { actor: string; clerkUserId: string },
): Promise<{ email: string }> {
  const { target, admins } = await current(client, clerkOrgId, input.clerkUserId);
  const problem = memberChangeProblem({
    actor: input.actor,
    target: input.clerkUserId,
    targetRole: target.role,
    change: "remove",
    admins,
  });
  if (problem) throw new Error(problem);
  await client.organizations.deleteOrganizationMembership({
    organizationId: clerkOrgId,
    userId: input.clerkUserId,
  });
  return { email: target.email };
}

export async function revokeInvitation(
  client: MembersClient,
  clerkOrgId: string,
  input: { actor: string; invitationId: string },
): Promise<void> {
  await client.organizations.revokeOrganizationInvitation({
    organizationId: clerkOrgId,
    invitationId: input.invitationId,
    requestingUserId: input.actor,
  });
}

/**
 * People join only by invitation and only we create organisations (D5-21): switch off
 * creating an organisation for a user. Called the first time Sendex sees them.
 */
export async function blockOrganisationCreation(
  client: MembersClient,
  clerkUserId: string,
): Promise<void> {
  await client.users.updateUser(clerkUserId, { createOrganizationEnabled: false });
}
