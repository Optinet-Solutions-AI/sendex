import {
  db,
  ensureOrganisation,
  ensureUser,
  getOrganisationByClerkId,
  getUserByClerkId,
  removeMembership,
  upsertMembership,
} from "@sendex/db";
import { Webhook, WebhookVerificationError } from "svix";
import {
  applyClerkEvent,
  type ClerkEventDeps,
  clerkEventSchema,
} from "../../../../lib/clerk-events";

export const runtime = "nodejs";

function tenancyDeps(): ClerkEventDeps {
  const database = db();
  return {
    ensureUser: (input) => ensureUser(database, input),
    ensureOrganisation: (input) => ensureOrganisation(database, input),
    getUserByClerkId: (id) => getUserByClerkId(database, id),
    getOrganisationByClerkId: (id) => getOrganisationByClerkId(database, id),
    upsertMembership: (input) => upsertMembership(database, input),
    removeMembership: (key) => removeMembership(database, key),
  };
}

/**
 * Clerk calls this on user, organisation and membership changes. Svix signs every delivery
 * with `CLERK_WEBHOOK_SECRET`; anything that fails verification is answered 400 and ignored.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "CLERK_WEBHOOK_SECRET is not set" }, { status: 500 });
  }

  const payload = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let verified: unknown;
  try {
    verified = new Webhook(secret).verify(payload, headers);
  } catch (error) {
    const reason = error instanceof WebhookVerificationError ? error.message : "bad signature";
    return Response.json({ error: reason }, { status: 400 });
  }

  const event = clerkEventSchema.safeParse(verified);
  if (!event.success) {
    return Response.json({ error: "malformed event" }, { status: 400 });
  }

  const result = await applyClerkEvent(event.data, tenancyDeps());
  return Response.json(result, { status: 200 });
}
