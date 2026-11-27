import { clerkClient } from "@clerk/nextjs/server";
import { PageHeader } from "@sendex/ui";
import { AuthError, requireAction } from "../../../../lib/auth";
import { authMode } from "../../../../lib/env";
import { type InvitationView, listMembers, type MemberView } from "../../../../lib/members";
import { AuthErrorView } from "../../require-org";
import { MembersManager } from "./members-manager";

export const dynamic = "force-dynamic";

/**
 * Members (D5-21): who can sign in to this organisation and with which access. Only an owner
 * (shown as co-admin) can see this page and change it. People join only by invitation; they
 * sign in with Google or their email and see only this organisation.
 */
export default async function MembersPage() {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("member.manage");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  let members: MemberView[] = [];
  let invitations: InvitationView[] = [];
  const clerk = authMode() === "clerk";
  if (clerk) {
    ({ members, invitations } = await listMembers(await clerkClient(), ctx.clerkOrgId));
  }
  return (
    <section className="max-w-4xl space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Members" }]}
        title="Members"
        subtitle="Who can sign in to this organisation, and what they can do."
      />
      <p className="max-w-3xl text-sm text-muted">
        Invite someone by email: they get a link, sign in with Google (or their email) and see only
        this organisation. Nobody can join or create an organisation without an invitation.{" "}
        <strong className="font-medium text-ink">Co-admin</strong> has the same access as you,
        including this page; <strong className="font-medium text-ink">Campaign manager</strong>{" "}
        uploads lists and creates and sends campaigns;{" "}
        <strong className="font-medium text-ink">Viewer</strong> can only look.
      </p>
      {clerk ? (
        <MembersManager
          me={ctx.clerkUserId}
          members={members}
          invitations={invitations.map((i) => ({ ...i, sentAt: i.sentAt.toISOString() }))}
        />
      ) : (
        <p className="text-sm text-muted" data-testid="members-dev-note">
          Members are managed in Clerk, which is off in this development sign-in.
        </p>
      )}
    </section>
  );
}
