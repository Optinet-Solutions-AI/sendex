import {
  campaignLinks,
  campaigns,
  contacts,
  laps,
  links,
  lists,
  messages,
  routes,
} from "@sendex/db";
import { seedOrganisation, type TestDb } from "@sendex/db/test";

export interface TrackedMessageSeed {
  organisationId: string;
  campaignId: string;
  lapId: string;
  listId: string;
  messageId: string;
  shortCode: string;
  dynamicId: string;
  e164: string;
  routeName: string;
}

export const LINK_TEMPLATE =
  "https://dest.example/?d={{dynamic}}&g={{geo}}&c={{campaign_id}}&l={{list_id}}&r={{route_name}}&p={{phone}}";

/**
 * One organisation, campaign (ES), list, route, lap, active link and a message that
 * carries `shortCode`: the minimum behind a redirect. Test-only.
 */
export async function seedTrackedMessage(
  db: TestDb["db"],
  options: { shortCode?: string; withLink?: boolean } = {},
): Promise<TrackedMessageSeed> {
  const shortCode = options.shortCode ?? "abcdefgh";
  const organisationId = await seedOrganisation(db, `org-${shortCode}`);
  const [campaign] = await db
    .insert(campaigns)
    .values({ organisationId, name: "c", country: "ES", timezone: "Europe/Madrid" })
    .returning({ id: campaigns.id });
  const [list] = await db
    .insert(lists)
    .values({ organisationId, name: "l", country: "ES" })
    .returning({ id: lists.id });
  const [route] = await db
    .insert(routes)
    .values({ provider: "fake", name: "23telecom", country: "ES" })
    .returning({ id: routes.id });
  const [contact] = await db
    .insert(contacts)
    .values({ organisationId, e164: "+34600000001", country: "ES" })
    .returning({ id: contacts.id });
  if (!campaign || !list || !route || !contact) throw new Error("seed failed");
  const [lap] = await db
    .insert(laps)
    .values({
      organisationId,
      campaignId: campaign.id,
      listId: list.id,
      routeId: route.id,
      testSize: 200,
    })
    .returning({ id: laps.id });
  if (!lap) throw new Error("seed failed");
  if (options.withLink !== false) {
    const [link] = await db
      .insert(links)
      .values({ organisationId, name: "offer", url: LINK_TEMPLATE })
      .returning({ id: links.id });
    if (!link) throw new Error("seed failed");
    await db
      .insert(campaignLinks)
      .values({ campaignId: campaign.id, linkId: link.id, organisationId });
  }
  const [message] = await db
    .insert(messages)
    .values({
      organisationId,
      campaignId: campaign.id,
      lapId: lap.id,
      contactId: contact.id,
      routeId: route.id,
      e164: "+34600000001",
      senderId: "LUCKY777",
      text: `Hello https://lnk.example/${shortCode}`,
      encoding: "GSM_7BIT",
      parts: 1,
      shortCode,
      dynamicId: `dyn-${shortCode}`,
      idempotencyKey: `${lap.id}:${contact.id}`,
    })
    .returning({ id: messages.id });
  if (!message) throw new Error("seed failed");
  return {
    organisationId,
    campaignId: campaign.id,
    lapId: lap.id,
    listId: list.id,
    messageId: message.id,
    shortCode,
    dynamicId: `dyn-${shortCode}`,
    e164: "+34600000001",
    routeName: "23telecom",
  };
}
