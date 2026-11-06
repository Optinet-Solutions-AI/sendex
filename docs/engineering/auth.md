# Authentication, tenancy and roles

Sendex uses [Clerk](https://clerk.com) for sign-in, organisations and sessions. The database
mirrors Clerk's users, organisations and memberships so every tenant table can carry a local
`organisation_id` (AGENTS.md rule 4) without a Clerk round trip per query.

## Tenancy model

| Clerk object           | Local table     | Key                                         |
| ---------------------- | --------------- | ------------------------------------------- |
| User                   | `users`         | `clerk_user_id` unique                      |
| Organization           | `organisations` | `clerk_org_id` unique                       |
| OrganizationMembership | `memberships`   | `(organisation_id, user_id)` unique, `role` |

Clerk is the source of truth. Local rows are written in two places, both through the query
helpers in `packages/db/src/queries/tenancy.ts` (`ensureUser`, `ensureOrganisation`,
`getMembership`, `upsertMembership`, `removeMembership`, plus the `get*ByClerkId` lookups):

1. **The webhook** (`apps/web/app/api/webhooks/clerk/route.ts`) receives Clerk events and
   calls `applyClerkEvent` (`apps/web/lib/clerk-events.ts`), a pure function tested with an
   in-memory fake of the tenancy helpers.
2. **`requireOrg()`** (`apps/web/lib/auth.ts`) runs on every server render or action. It reads
   Clerk's `auth()` (`userId`, `orgId`, `orgRole`), looks up the local rows and creates them on
   first sight, so a user who signs in before the webhook has been delivered still works. If
   the session role differs from the stored membership the membership is updated.
   A returning member costs one query: `getTenantByClerkIds` joins the user, the organisation
   and the membership role, and nothing is written when the role matches the session. Only a
   user or organisation seen for the first time goes through `ensureUser` / `ensureOrganisation`
   one by one. `requireOrg()` is wrapped in React's `cache()`, so the dashboard layout, the page
   and any server action of the same request resolve the tenant once (D3-22).

`requireOrg()` returns `{ userId, clerkUserId, organisationId, clerkOrgId, role }`. It throws
an `AuthError` with `status` 401 (`unauthenticated`) when there is no session and 403
(`no_organisation`) when the user has not picked an active organisation. Dashboard pages
wrap their body in `<RequireOrg>` (`apps/web/app/(dashboard)/require-org.tsx`), which renders
the error as a page instead of crashing.

The middleware (`apps/web/middleware.ts`) protects every route except `/sign-in`, `/sign-up`,
`/api/webhooks/*` and `/health`. When the Clerk keys are missing the middleware passes requests
through and the root layout renders a setup page listing the variables to set. In every mode it
also sets the security headers and a nonce-based Content Security Policy on the response and
forwards the nonce to the app; see `security-headers.md`, which also covers CSRF.

## Auth modes

`authMode()` in `apps/web/lib/env.ts` is the single place that decides how a request is
authenticated; the middleware, the layouts, `requireOrg()` and `assertRecentAuth()` all read it.

| Mode           | When                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| `clerk`        | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set. Always wins. |
| `dev`          | No Clerk keys, `SENDEX_DEV_AUTH=1` and `NODE_ENV` is not `production`.           |
| `unconfigured` | Neither. The root layout renders the setup page.                                 |

### Development auth stub

Until a Clerk application exists (and for Playwright, which has no browser session to hand),
`SENDEX_DEV_AUTH=1` signs every request in as a seeded user. `requireOrg()` calls
`devOrgContext()` (`apps/web/lib/dev-auth.ts`), which goes through the same tenancy helpers as
the Clerk sync (`ensureUser`, `ensureOrganisation`, `upsertMembership`) so the rest of the app
sees an ordinary organisation:

| Variable              | Default    | Effect                                                   |
| --------------------- | ---------- | -------------------------------------------------------- |
| `SENDEX_DEV_AUTH`     | unset      | `1` enables the stub (any other value is ignored)        |
| `SENDEX_DEV_ORG_SLUG` | `external` | organisation slug; rows use `dev_org_<slug>` as Clerk id |
| `SENDEX_DEV_ROLE`     | `owner`    | `owner`, `campaign_manager` or `viewer`                  |

The seeded user is `dev_user_<slug>` (`dev-<slug>@sendex.local`). The organisation is looked
up by slug first (`getOrganisationBySlug`): if `pnpm db:seed` has already created it with its
own Clerk id the stub joins that row, otherwise it creates one as `dev_org_<slug>`. Each
request re-applies the membership, so changing `SENDEX_DEV_ROLE` takes effect on the next
page load. In this mode the middleware
passes requests through and redirects `/sign-in` and `/sign-up` to `/`, the root layout skips
`ClerkProvider`, the dashboard top bar shows an amber "Development login: external as owner"
banner instead of the organisation switcher and user menu, `/settings` shows a note instead of
Clerk's `UserProfile`, and `assertRecentAuth()` passes.

The stub cannot be enabled in production: `authMode()` returns `unconfigured` for
`NODE_ENV=production` whatever `SENDEX_DEV_AUTH` says, and `clerk` whenever the keys are
present. Both rules are covered by unit tests (`env.test.ts`, `auth.test.ts`).

## Roles and permissions

Roles live in `packages/core/src/permissions.ts` and in the `member_role` enum in the schema.

| Clerk org role | Sendex role        |
| -------------- | ------------------ |
| `org:admin`    | `owner`            |
| `org:member`   | `campaign_manager` |
| anything else  | `viewer`           |

The mapping is `roleFromClerk()` in `apps/web/lib/clerk-roles.ts`; unknown or custom Clerk
roles fall to `viewer` so a misconfigured role never grants more than read access.

`can(role, action)` is the single permission check:

| Action                                              | owner | campaign_manager | viewer |
| --------------------------------------------------- | :---: | :--------------: | :----: |
| `campaign.create`, `campaign.send`, `campaign.stop` |  yes  |       yes        |   no   |
| `list.upload`, `list.flush`                         |  yes  |       yes        |   no   |
| `campaign.view`, `list.view`, `settings.view`       |  yes  |       yes        |  yes   |
| `settings.manage`, `balance.deposit`                |  yes  |        no        |   no   |
| `member.manage`, `emergency.stop`, `audit.view`     |  yes  |        no        |   no   |

Use `requireAction(action)` in server actions and route handlers: it calls `requireOrg()` and
throws `AuthError` 403 (`forbidden`) when `can()` says no. Pages pass `action` to
`<RequireOrg action="…">`.

## Webhook sync

Create a webhook endpoint in the Clerk dashboard pointing at
`https://<web host>/api/webhooks/clerk` and subscribe to:

- `user.created`, `user.updated`: upsert `users` (primary email, full name).
- `organization.created`, `organization.updated`: upsert `organisations` (name, slug).
- `organizationMembership.created`, `organizationMembership.updated`: upsert the membership
  with the mapped role, creating the organisation and user rows first if the events arrived
  out of order.
- `organizationMembership.deleted`: delete the membership. The user row is kept.

Put the endpoint's signing secret in `CLERK_WEBHOOK_SECRET`. Every delivery is verified with
Svix (`svix-id`, `svix-timestamp`, `svix-signature` headers); a bad signature is answered 400
and nothing is written. Other event types are acknowledged with `handled: false` so Clerk does
not retry them. Locally, run `ngrok http 3000` (or the Clerk CLI tunnel) and point the endpoint
at the tunnel.

## Re-authentication for sensitive actions

Depositing balance, flushing a list and the emergency stop must call `assertRecentAuth()`
from `apps/web/lib/reauth.ts` before doing anything. It passes when either:

- the session token's first-factor verification age (`fva` claim, minutes) is within
  `maxAgeSeconds` (default 300), or
- the Clerk session's `createdAt` (Backend API) is within `maxAgeSeconds`.

`lastActiveAt` is deliberately not used: it moves on every request, so a stolen session would
always look fresh. When the check fails it throws `AuthError` 403 `reauth_required`; the client
should call Clerk's `useReverification()` to re-prompt for the password and retry.

## Two-factor authentication policy

Owners must have 2FA enabled. This is enforced in Clerk, not in code:

1. Clerk dashboard, User & authentication, Multi-factor: enable **Authenticator application**
   and **Backup codes**; SMS codes are optional.
2. Set multi-factor to **Required** for the production instance (or use the `TaskSetupMFA`
   session task so new users are forced through setup at first sign-in).
3. Audit: the Clerk user list shows who has 2FA; `audit.view` holders should check it monthly.

Until the dashboard setting is on, `assertRecentAuth()` still limits the blast radius of a
stolen session to non-sensitive actions.

## Device list

`/settings` (`apps/web/app/(dashboard)/settings/page.tsx`) mounts Clerk's `UserProfile`
behind `settings.view`. Its **Security** tab lists the user's active devices and sessions and
lets them sign out any of them, change their password and manage 2FA. Nothing is stored
locally; the list is served by Clerk.

## Environment variables

| Variable                            | Where it comes from                              |
| ----------------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard, API keys                        |
| `CLERK_SECRET_KEY`                  | Clerk dashboard, API keys                        |
| `CLERK_WEBHOOK_SECRET`              | Clerk dashboard, Webhooks, the endpoint's secret |

Sign-in and sign-up URLs are set in code (`/sign-in`, `/sign-up`) on both `ClerkProvider`
and `clerkMiddleware`, so no extra `NEXT_PUBLIC_CLERK_*_URL` variables are needed.
