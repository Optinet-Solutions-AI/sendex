import type { Role } from "@sendex/core";

/**
 * Map a Clerk organisation role to a Sendex role.
 * Clerk's default roles are `org:admin` and `org:member`; anything else (custom roles,
 * missing role) is treated as read only so a misconfiguration never grants extra rights.
 */
export function roleFromClerk(orgRole: string | null | undefined): Role {
  switch (orgRole) {
    case "org:admin":
      return "owner";
    case "org:member":
      return "campaign_manager";
    default:
      return "viewer";
  }
}
