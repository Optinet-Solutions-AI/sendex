import type { Role } from "@sendex/core";
import { z } from "zod";
import { roleFromClerk } from "./clerk-roles";

/**
 * Pure handler for Clerk webhook events. The route verifies the signature and passes the
 * parsed body here; `deps` is the subset of `@sendex/db` tenancy queries we need, so tests
 * can run against an in-memory fake.
 */

const nullableString = z.string().nullable().optional();

const userData = z.object({
  id: z.string(),
  email_addresses: z.array(z.object({ id: z.string(), email_address: z.string() })).default([]),
  primary_email_address_id: nullableString,
  first_name: nullableString,
  last_name: nullableString,
});

const organisationData = z.object({
  id: z.string(),
  name: z.string(),
  slug: nullableString,
});

const membershipData = z.object({
  id: z.string(),
  role: z.string(),
  organization: organisationData,
  public_user_data: z.object({
    user_id: z.string(),
    identifier: z.string(),
    first_name: nullableString,
    last_name: nullableString,
  }),
});

/** The envelope every Clerk event shares. `data` is validated per event type. */
export const clerkEventSchema = z.object({ type: z.string(), data: z.unknown() });
export type ClerkEvent = z.infer<typeof clerkEventSchema>;

export interface TenancyRow {
  id: string;
}

export interface ClerkEventDeps {
  ensureUser(input: {
    clerkUserId: string;
    email: string;
    name?: string | null;
  }): Promise<TenancyRow>;
  ensureOrganisation(input: {
    clerkOrgId: string;
    name: string;
    slug: string;
  }): Promise<TenancyRow>;
  getUserByClerkId(clerkUserId: string): Promise<TenancyRow | null>;
  getOrganisationByClerkId(clerkOrgId: string): Promise<TenancyRow | null>;
  upsertMembership(input: { organisationId: string; userId: string; role: Role }): Promise<unknown>;
  removeMembership(key: { organisationId: string; userId: string }): Promise<boolean>;
}

export type ClerkEventResult =
  | { handled: true; type: string; summary: string }
  | { handled: false; type: string; reason: string };

function fullName(first: string | null | undefined, last: string | null | undefined) {
  const name = [first, last].filter((part): part is string => Boolean(part?.trim())).join(" ");
  return name.length > 0 ? name : null;
}

function primaryEmail(data: z.infer<typeof userData>): string | null {
  const primary =
    data.email_addresses.find((e) => e.id === data.primary_email_address_id) ??
    data.email_addresses[0];
  return primary?.email_address ?? null;
}

function invalid(type: string, error: z.ZodError): ClerkEventResult {
  return { handled: false, type, reason: `invalid payload: ${error.issues[0]?.message ?? "?"}` };
}

export async function applyClerkEvent(
  event: ClerkEvent,
  deps: ClerkEventDeps,
): Promise<ClerkEventResult> {
  const { type } = event;
  switch (type) {
    case "user.created":
    case "user.updated": {
      const parsed = userData.safeParse(event.data);
      if (!parsed.success) return invalid(type, parsed.error);
      const email = primaryEmail(parsed.data);
      if (!email) return { handled: false, type, reason: "user has no email address" };
      await deps.ensureUser({
        clerkUserId: parsed.data.id,
        email,
        name: fullName(parsed.data.first_name, parsed.data.last_name),
      });
      return { handled: true, type, summary: `user ${parsed.data.id} synced` };
    }

    case "organization.created":
    case "organization.updated": {
      const parsed = organisationData.safeParse(event.data);
      if (!parsed.success) return invalid(type, parsed.error);
      await deps.ensureOrganisation({
        clerkOrgId: parsed.data.id,
        name: parsed.data.name,
        slug: parsed.data.slug ?? parsed.data.id,
      });
      return { handled: true, type, summary: `organisation ${parsed.data.id} synced` };
    }

    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const parsed = membershipData.safeParse(event.data);
      if (!parsed.success) return invalid(type, parsed.error);
      const { organization, public_user_data: who } = parsed.data;
      const organisation = await deps.ensureOrganisation({
        clerkOrgId: organization.id,
        name: organization.name,
        slug: organization.slug ?? organization.id,
      });
      const user =
        (await deps.getUserByClerkId(who.user_id)) ??
        (await deps.ensureUser({
          clerkUserId: who.user_id,
          email: who.identifier,
          name: fullName(who.first_name, who.last_name),
        }));
      const role = roleFromClerk(parsed.data.role);
      await deps.upsertMembership({ organisationId: organisation.id, userId: user.id, role });
      return {
        handled: true,
        type,
        summary: `membership ${who.user_id} in ${organization.id} set to ${role}`,
      };
    }

    case "organizationMembership.deleted": {
      const parsed = membershipData.safeParse(event.data);
      if (!parsed.success) return invalid(type, parsed.error);
      const { organization, public_user_data: who } = parsed.data;
      const organisation = await deps.getOrganisationByClerkId(organization.id);
      const user = await deps.getUserByClerkId(who.user_id);
      if (!organisation || !user) {
        return { handled: true, type, summary: "membership already absent" };
      }
      const removed = await deps.removeMembership({
        organisationId: organisation.id,
        userId: user.id,
      });
      return {
        handled: true,
        type,
        summary: removed
          ? `membership ${who.user_id} in ${organization.id} removed`
          : "membership already absent",
      };
    }

    default:
      return { handled: false, type, reason: "event type not handled" };
  }
}
