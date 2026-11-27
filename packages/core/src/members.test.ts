import { describe, expect, it } from "vitest";
import {
  changeMemberRoleSchema,
  clerkRoleFor,
  inviteMemberSchema,
  MEMBER_ROLE_LABELS,
  memberChangeProblem,
  removeMemberSchema,
  revokeInvitationSchema,
} from "./members.js";

describe("member roles (D5-21)", () => {
  it("maps each Sendex role to its Clerk organisation role", () => {
    expect(clerkRoleFor("owner")).toBe("org:admin");
    expect(clerkRoleFor("campaign_manager")).toBe("org:member");
    expect(clerkRoleFor("viewer")).toBe("org:viewer");
  });

  it("names an owner a co-admin in the members screen", () => {
    expect(MEMBER_ROLE_LABELS).toEqual({
      owner: "Co-admin",
      campaign_manager: "Campaign manager",
      viewer: "Viewer",
    });
  });
});

describe("member forms", () => {
  it("takes an email, trimmed and lower case, and a role", () => {
    expect(inviteMemberSchema.parse({ email: "  Danny@Example.com ", role: "viewer" })).toEqual({
      email: "danny@example.com",
      role: "viewer",
    });
    expect(() => inviteMemberSchema.parse({ email: "not-an-email", role: "viewer" })).toThrow();
    expect(() => inviteMemberSchema.parse({ email: "a@b.co", role: "boss" })).toThrow();
  });

  it("takes a Clerk user or invitation id", () => {
    expect(changeMemberRoleSchema.parse({ clerkUserId: "user_123", role: "owner" })).toEqual({
      clerkUserId: "user_123",
      role: "owner",
    });
    expect(() => removeMemberSchema.parse({ clerkUserId: "" })).toThrow();
    expect(revokeInvitationSchema.parse({ invitationId: "orginv_1" })).toEqual({
      invitationId: "orginv_1",
    });
  });
});

describe("memberChangeProblem", () => {
  const admins = ["user_emily"];

  it("lets an admin change or remove someone else", () => {
    expect(
      memberChangeProblem({
        actor: "user_emily",
        target: "user_ana",
        targetRole: "campaign_manager",
        change: { role: "viewer" },
        admins,
      }),
    ).toBeNull();
    expect(
      memberChangeProblem({
        actor: "user_emily",
        target: "user_ana",
        targetRole: "viewer",
        change: "remove",
        admins,
      }),
    ).toBeNull();
  });

  it("refuses changing or removing your own access", () => {
    expect(
      memberChangeProblem({
        actor: "user_emily",
        target: "user_emily",
        targetRole: "owner",
        change: { role: "viewer" },
        admins,
      }),
    ).toBe("You cannot change your own access. Ask another co-admin.");
  });

  it("keeps at least one admin", () => {
    expect(
      memberChangeProblem({
        actor: "user_co",
        target: "user_emily",
        targetRole: "owner",
        change: "remove",
        admins: ["user_emily"],
      }),
    ).toBe("The organisation needs at least one co-admin.");
    expect(
      memberChangeProblem({
        actor: "user_co",
        target: "user_emily",
        targetRole: "owner",
        change: { role: "campaign_manager" },
        admins: ["user_emily", "user_co"],
      }),
    ).toBeNull();
  });
});
