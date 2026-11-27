"use server";

import { clerkClient } from "@clerk/nextjs/server";
import {
  changeMemberRoleSchema,
  inviteMemberSchema,
  MEMBER_ROLE_LABELS,
  removeMemberSchema,
  revokeInvitationSchema,
} from "@sendex/core";
import { db, recordAudit } from "@sendex/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { AuthError, type OrgContext, requireAction } from "../../../../lib/auth";
import { authMode } from "../../../../lib/env";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvitation,
} from "../../../../lib/members";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Members actions (D5-21): only an owner (Emily, or someone she made co-admin) may call them
 * (`member.manage`). Every change goes to Clerk, which holds memberships, and to the audit log.
 */
async function run<T>(fn: (ctx: OrgContext) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ctx = await requireAction("member.manage");
    if (authMode() !== "clerk") {
      return { ok: false, error: "Members are managed in Clerk, which is off in development." };
    }
    const data = await fn(ctx);
    revalidatePath("/settings/members");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    }
    const message = clerkMessage(error);
    if (message) return { ok: false, error: message };
    console.error("members action failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Our own rule messages, and Clerk's readable error (e.g. already a member, limit reached). */
function clerkMessage(error: unknown): string | null {
  const errors = (error as { errors?: { longMessage?: string; message?: string }[] }).errors;
  const clerk = errors?.[0]?.longMessage ?? errors?.[0]?.message;
  if (clerk) return clerk;
  if (
    error instanceof Error &&
    /own access|at least one co-admin|not a member/.test(error.message)
  ) {
    return error.message;
  }
  return null;
}

/** Where the invitation link lands: this site's sign-up page. */
async function signUpUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/sign-up`;
}

export async function inviteMemberAction(input: unknown): Promise<ActionResult<{ email: string }>> {
  return run(async (ctx) => {
    const { email, role } = inviteMemberSchema.parse(input);
    await inviteMember(await clerkClient(), ctx.clerkOrgId, {
      email,
      role,
      inviterClerkUserId: ctx.clerkUserId,
      redirectUrl: await signUpUrl(),
    });
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "member.invite",
      targetType: "member",
      targetId: email,
      details: { email, role: MEMBER_ROLE_LABELS[role] },
    });
    return { email };
  });
}

export async function changeMemberRoleAction(
  input: unknown,
): Promise<ActionResult<{ saved: true }>> {
  return run(async (ctx) => {
    const { clerkUserId, role } = changeMemberRoleSchema.parse(input);
    const change = await changeMemberRole(await clerkClient(), ctx.clerkOrgId, {
      actor: ctx.clerkUserId,
      clerkUserId,
      role,
    });
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "member.role",
      targetType: "member",
      targetId: clerkUserId,
      details: { from: MEMBER_ROLE_LABELS[change.from], to: MEMBER_ROLE_LABELS[change.to] },
    });
    return { saved: true };
  });
}

export async function removeMemberAction(input: unknown): Promise<ActionResult<{ removed: true }>> {
  return run(async (ctx) => {
    const { clerkUserId } = removeMemberSchema.parse(input);
    const removed = await removeMember(await clerkClient(), ctx.clerkOrgId, {
      actor: ctx.clerkUserId,
      clerkUserId,
    });
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "member.remove",
      targetType: "member",
      targetId: clerkUserId,
      details: { email: removed.email },
    });
    return { removed: true };
  });
}

export async function revokeInvitationAction(
  input: unknown,
): Promise<ActionResult<{ revoked: true }>> {
  return run(async (ctx) => {
    const { invitationId } = revokeInvitationSchema.parse(input);
    await revokeInvitation(await clerkClient(), ctx.clerkOrgId, {
      actor: ctx.clerkUserId,
      invitationId,
    });
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "member.invite_revoke",
      targetType: "member",
      targetId: invitationId,
      details: {},
    });
    return { revoked: true };
  });
}
