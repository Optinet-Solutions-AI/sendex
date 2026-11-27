# ADR 0014: Members join by invitation only, managed in Sendex, held in Clerk

Date: 2026-11-27. Status: accepted.

## Context

Christian, 27 November 2026: Emily should add people to her organisation by email; they sign in with Google and can only reach her organisation; they cannot create organisations of their own; only Emily manages who has access, unless she makes someone co-admin. Until then members were managed only through Clerk's own organisation window, anyone signed in could create an organisation, and sign-up was open.

Clerk already holds memberships and roles, and every request reads the role from the Clerk session (`org:admin` → owner, `org:member` → campaign manager, anything else → viewer).

## Decision

- **Settings › Members in Sendex** lists members and pending invitations and invites, changes, removes and cancels, through Clerk's backend API (`apps/web/lib/members.ts`). Only `member.manage` (owners) can open it or call its actions.
- **Roles stay in Clerk.** Co-admin is Clerk's `org:admin` (Sendex owner: the same access as Emily), Campaign manager is `org:member`, Viewer is a custom Clerk role `org:viewer`.
- **Safety rules** (`memberChangeProblem` in core): nobody changes or removes their own access, and an organisation always keeps one co-admin.
- **No self-made organisations:** the first time Sendex sees a user, it switches off `create_organization_enabled` on their Clerk user; existing users were switched off once. The organisation menu hides the personal account and its "Manage" opens the Members page.
- **Invitation only, for every organisation:** Clerk's sign-up mode is Restricted, so an account can only be created from an invitation. Google sign-in stays on.

## Consequences

- New QA testers, and anyone else, need an invitation from an organisation's co-admin (or from us in Clerk).
- Only the platform team creates organisations, in Clerk.
- Clerk limits members per organisation (5 on the current plan); an invitation past the limit is refused with Clerk's message.
- Clerk webhooks are not configured: the role mirror in Sendex still happens on each request, as before.
