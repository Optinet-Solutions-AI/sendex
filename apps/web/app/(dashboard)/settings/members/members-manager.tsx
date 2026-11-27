"use client";

import { MEMBER_ROLE_LABELS, type Role } from "@sendex/core";
import { Button, Card, CardHeader, ConfirmDialog, IconButton } from "@sendex/ui";
import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
} from "./actions";

interface Member {
  clerkUserId: string;
  name: string | null;
  email: string;
  role: Role;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  sentAt: string;
}

/** The roles in the order offered: most common first. */
const ROLE_CHOICES: Role[] = ["campaign_manager", "viewer", "owner"];

const selectClass = "h-9 rounded-md border border-rule bg-surface px-2 text-sm";

/** Invite by email, change a member's access, remove a member, cancel an invitation (D5-21). */
export function MembersManager({
  me,
  members,
  invitations,
}: {
  me: string;
  members: Member[];
  invitations: Invitation[];
}) {
  const id = useId();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("campaign_manager");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [pending, start] = useTransition();

  function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (done) setNotice(done);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Invite someone" note="They get an email with a link to join" />
        <form
          className="flex flex-wrap items-end gap-3 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const to = email.trim();
            act(async () => {
              const result = await inviteMemberAction({ email: to, role });
              if (result.ok) setEmail("");
              return result;
            }, `Invitation sent to ${to}.`);
          }}
        >
          <label
            className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm"
            htmlFor={`${id}-email`}
          >
            <span className="font-medium text-ink">Email</span>
            <input
              id={`${id}-email`}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="h-9 rounded-md border border-rule bg-surface px-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-role`}>
            <span className="font-medium text-ink">Access</span>
            <select
              id={`${id}-role`}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className={selectClass}
            >
              {ROLE_CHOICES.map((r) => (
                <option key={r} value={r}>
                  {MEMBER_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" disabled={pending || email.trim() === ""}>
            Send invitation
          </Button>
        </form>
      </Card>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm text-good" data-testid="members-notice">
          {notice}
        </p>
      ) : null}

      <Card>
        <CardHeader title="Members" note={`${members.length}`} />
        <ul className="divide-y divide-rule" data-testid="members-list">
          {members.map((m) => {
            const self = m.clerkUserId === me;
            return (
              <li key={m.clerkUserId} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">
                    {m.name ?? m.email}
                    {self ? <span className="ml-2 text-xs text-muted">(you)</span> : null}
                  </div>
                  {m.name ? <div className="truncate text-xs text-muted">{m.email}</div> : null}
                </div>
                <select
                  aria-label={`Access for ${m.email}`}
                  value={m.role}
                  disabled={pending || self}
                  title={self ? "You cannot change your own access" : undefined}
                  onChange={(e) => {
                    const next = e.target.value as Role;
                    act(
                      () => changeMemberRoleAction({ clerkUserId: m.clerkUserId, role: next }),
                      `${m.email} is now ${MEMBER_ROLE_LABELS[next]}.`,
                    );
                  }}
                  className={selectClass}
                >
                  {ROLE_CHOICES.map((r) => (
                    <option key={r} value={r}>
                      {MEMBER_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <IconButton
                  label={`Remove ${m.email}`}
                  tooltip={self ? "You cannot remove yourself" : "Remove from the organisation"}
                  icon={<Trash2 />}
                  tone="danger"
                  disabled={pending || self}
                  onClick={() => setRemoving(m)}
                />
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Invitations waiting" note={`${invitations.length}`} />
        {invitations.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">No invitations waiting.</p>
        ) : (
          <ul className="divide-y divide-rule" data-testid="invitations-list">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium text-ink">{i.email}</span>
                  <span className="ml-2 text-xs text-muted">
                    {MEMBER_ROLE_LABELS[i.role]} · sent {i.sentAt.slice(0, 10)}
                  </span>
                </div>
                <IconButton
                  label={`Cancel the invitation to ${i.email}`}
                  tooltip="Cancel invitation"
                  icon={<X />}
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => revokeInvitationAction({ invitationId: i.id }),
                      `Invitation to ${i.email} cancelled.`,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing?.email ?? ""}?`}
        description="They will no longer be able to sign in to this organisation. You can invite them again later."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          const who = removing;
          const result = await removeMemberAction({ clerkUserId: who.clerkUserId });
          if (!result.ok) throw new Error(result.error);
          setNotice(`${who.email} removed.`);
          router.refresh();
        }}
      />
    </div>
  );
}
