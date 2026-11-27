import { z } from "zod";
import type { Role } from "./permissions.js";

/**
 * Members of an organisation (D5-21). People join only by invitation from an organisation's
 * owner (shown as co-admin); they sign in with Google or email through Clerk and see only the
 * organisation that invited them. Roles live in Clerk; Sendex reads them from the session.
 */

/** The Clerk organisation role behind each Sendex role. `org:viewer` is a custom role. */
export const CLERK_ROLE_FOR: Record<Role, string> = {
  owner: "org:admin",
  campaign_manager: "org:member",
  viewer: "org:viewer",
};

export function clerkRoleFor(role: Role): string {
  return CLERK_ROLE_FOR[role];
}

/** How the members screen names each role. An owner can manage members: a co-admin. */
export const MEMBER_ROLE_LABELS: Record<Role, string> = {
  owner: "Co-admin",
  campaign_manager: "Campaign manager",
  viewer: "Viewer",
};

const roleSchema = z.enum(["owner", "campaign_manager", "viewer"]);
const clerkId = z.string().trim().min(1).max(100);

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  role: roleSchema,
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const changeMemberRoleSchema = z.object({ clerkUserId: clerkId, role: roleSchema });
export const removeMemberSchema = z.object({ clerkUserId: clerkId });
export const revokeInvitationSchema = z.object({ invitationId: clerkId });

export interface MemberChange {
  /** Clerk user id of the person making the change. */
  actor: string;
  /** Clerk user id of the member being changed. */
  target: string;
  targetRole: Role;
  change: { role: Role } | "remove";
  /** Clerk user ids of the organisation's current owners (co-admins). */
  admins: readonly string[];
}

/**
 * Why a change to someone's access is refused, or null when it may go ahead. Nobody changes
 * their own access (so nobody locks themselves out), and the last co-admin stays one.
 */
export function memberChangeProblem(input: MemberChange): string | null {
  if (input.actor === input.target) {
    return "You cannot change your own access. Ask another co-admin.";
  }
  const losesAdmin =
    input.targetRole === "owner" && (input.change === "remove" || input.change.role !== "owner");
  if (losesAdmin && input.admins.filter((id) => id !== input.target).length === 0) {
    return "The organisation needs at least one co-admin.";
  }
  return null;
}
