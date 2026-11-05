import postgres from "postgres";

/**
 * Direct database cleanup for the e2e specs. Deletes the lists whose name starts with
 * `namePrefix` (members cascade) and the contacts whose number starts with `e164Prefix`,
 * so an upload spec can run again and again against the same seeded database. Test-only:
 * application code never runs raw SQL (AGENTS.md rule 4).
 */
export async function cleanupE2eLists(namePrefix: string, e164Prefix: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the lists e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from lists where name like ${`${namePrefix}%`}`;
    await sql`delete from contacts where e164 like ${`${e164Prefix}%`}`;
  } finally {
    await sql.end();
  }
}

/**
 * Reset the sending progress of a seeded list so a campaign spec sees the full list again,
 * no matter what the engine sent earlier. Mirrors the app's flush (list_members.sent_at
 * cleared, flushed_at stamped) and leaves messages and ledger rows untouched.
 */
export async function flushListByName(name: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the campaigns e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`update list_members set sent_at = null, flushed_at = now()
      where list_id in (select id from lists where name = ${name})`;
  } finally {
    await sql.end();
  }
}

export interface SeededPostback {
  campaignId: string;
  campaignName: string;
  eventKey: string;
  dynamicId: string;
  senderId: string;
  adText: string;
}

/** Numbers the postbacks spec creates start with this; the lists spec uses a different prefix. */
export const POSTBACK_E164_PREFIX = "+34698";

/**
 * A finished campaign of the seeded "external" organisation with one sent message and one
 * lead postback attributed to it (lap counter included), as the worker's ingest would leave
 * them. The worker is not running under Playwright, so the rows go in directly. Test-only.
 */
export async function seedE2ePostback(namePrefix: string): Promise<SeededPostback> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the postbacks e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    const [org] = await sql<{ id: string }[]>`select id from organisations where slug = 'external'`;
    const [list] = await sql<{ id: string }[]>`
      select id from lists where organisation_id = ${org?.id ?? ""} and country = 'ES' limit 1`;
    const [route] = await sql<{ id: string }[]>`select id from routes where name = '405' limit 1`;
    if (!org || !list || !route) throw new Error("demo seed missing: run pnpm db:seed");

    const campaignName = `${namePrefix} ${Date.now()}`;
    const [campaign] = await sql<{ id: string }[]>`
      insert into campaigns (organisation_id, name, country, timezone, status)
      values (${org.id}, ${campaignName}, 'ES', 'Europe/Madrid', 'completed') returning id`;
    if (!campaign) throw new Error("campaign insert failed");
    const adText = "E2E postback text";
    const [text] = await sql<{ id: string }[]>`
      insert into ad_texts (organisation_id, campaign_id, text, encoding)
      values (${org.id}, ${campaign.id}, ${adText}, 'GSM_7BIT') returning id`;
    const [lap] = await sql<{ id: string }[]>`
      insert into laps (organisation_id, campaign_id, list_id, route_id, test_size, status, sent, cost_micro, leads)
      values (${org.id}, ${campaign.id}, ${list.id}, ${route.id}, 1, 'done', 1, 25000, 1) returning id`;
    const e164 = `${POSTBACK_E164_PREFIX}${String(Date.now() % 1_000_000).padStart(6, "0")}`;
    const [contact] = await sql<{ id: string }[]>`
      insert into contacts (organisation_id, e164, country) values (${org.id}, ${e164}, 'ES')
      on conflict (organisation_id, e164) do update set country = 'ES' returning id`;
    if (!text || !lap || !contact) throw new Error("postback seed failed");

    const dynamicId = crypto.randomUUID();
    const senderId = "E2ESID";
    const [message] = await sql<{ id: string }[]>`
      insert into messages (organisation_id, campaign_id, lap_id, contact_id, e164, sender_id, text,
        encoding, parts, route_id, status, dynamic_id, ad_text_id, idempotency_key)
      values (${org.id}, ${campaign.id}, ${lap.id}, ${contact.id}, ${e164}, ${senderId}, ${adText},
        'GSM_7BIT', 1, ${route.id}, 'sent', ${dynamicId}, ${text.id}, ${`e2e:${dynamicId}`})
      returning id`;
    if (!message) throw new Error("message insert failed");

    const eventKey = `lead_e2e${dynamicId.replace(/-/g, "").slice(0, 24)}`;
    await sql`
      insert into postbacks (organisation_id, event_key, type, dynamic_id, message_id, campaign_id, lap_id, params)
      values (${org.id}, ${eventKey}, 'lead', ${dynamicId}, ${message.id}, ${campaign.id}, ${lap.id},
        ${sql.json({ type: "lead", dynamic_id: dynamicId, sub_id: "e2e" })})`;
    return { campaignId: campaign.id, campaignName, eventKey, dynamicId, senderId, adText };
  } finally {
    await sql.end();
  }
}

/** Remove everything `seedE2ePostback` created for campaigns whose name starts with `namePrefix`. */
export async function cleanupE2ePostbacks(namePrefix: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the postbacks e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from postbacks where event_key like 'lead_e2e%'`;
    await sql`delete from campaigns where name like ${`${namePrefix}%`}`;
    await sql`delete from contacts where e164 like ${`${POSTBACK_E164_PREFIX}%`}`;
  } finally {
    await sql.end();
  }
}

export interface SeededDelivery {
  campaignId: string;
  campaignName: string;
  senderId: string;
  adText: string;
  linkName: string;
}

/** Numbers the delivery spec creates start with this. */
export const DELIVERY_E164_PREFIX = "+34697";

/**
 * A finished campaign of the seeded "external" organisation as the worker leaves it after
 * delivery receipts and clicks (D3-01, D2-13): one lap of 100 sent, 95 delivered, 5 failed,
 * 5 clicking recipients, plus two delivered messages with clicks behind the per-sender,
 * per-text and per-link breakdowns (the first clicked twice, the second never). Test-only.
 */
export async function seedE2eDelivery(namePrefix: string): Promise<SeededDelivery> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the delivery e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    const [org] = await sql<{ id: string }[]>`select id from organisations where slug = 'external'`;
    const [list] = await sql<{ id: string }[]>`
      select id from lists where organisation_id = ${org?.id ?? ""} and country = 'ES' limit 1`;
    const [route] = await sql<{ id: string }[]>`select id from routes where name = '405' limit 1`;
    if (!org || !list || !route) throw new Error("demo seed missing: run pnpm db:seed");

    const campaignName = `${namePrefix} ${Date.now()}`;
    const [campaign] = await sql<{ id: string }[]>`
      insert into campaigns (organisation_id, name, country, timezone, status)
      values (${org.id}, ${campaignName}, 'ES', 'Europe/Madrid', 'completed') returning id`;
    if (!campaign) throw new Error("campaign insert failed");
    const adText = "E2E delivery text";
    const [text] = await sql<{ id: string }[]>`
      insert into ad_texts (organisation_id, campaign_id, text, encoding)
      values (${org.id}, ${campaign.id}, ${adText}, 'GSM_7BIT') returning id`;
    const linkName = "E2E offer";
    const [link] = await sql<{ id: string }[]>`
      insert into links (organisation_id, name, url)
      values (${org.id}, ${linkName}, 'https://dest.example/?d={{dynamic}}') returning id`;
    const [lap] = await sql<{ id: string }[]>`
      insert into laps (organisation_id, campaign_id, list_id, route_id, test_size, status,
        sent, delivered, failed, clicks, cost_micro, started_at, finished_at)
      values (${org.id}, ${campaign.id}, ${list.id}, ${route.id}, 100, 'done',
        100, 95, 5, 5, 2500000, now() - interval '1 hour', now()) returning id`;
    if (!text || !link || !lap) throw new Error("delivery seed failed");

    const senderId = "E2EDLR";
    const base = Date.now() % 1_000_000;
    for (const [i, clicks] of [2, 0].entries()) {
      const e164 = `${DELIVERY_E164_PREFIX}${String((base + i) % 1_000_000).padStart(6, "0")}`;
      const [contact] = await sql<{ id: string }[]>`
        insert into contacts (organisation_id, e164, country) values (${org.id}, ${e164}, 'ES')
        on conflict (organisation_id, e164) do update set country = 'ES' returning id`;
      if (!contact) throw new Error("contact insert failed");
      const [message] = await sql<{ id: string }[]>`
        insert into messages (organisation_id, campaign_id, lap_id, contact_id, e164, sender_id,
          text, encoding, parts, route_id, status, provider_message_id, short_code, dynamic_id,
          ad_text_id, link_id, idempotency_key, sent_at, delivered_at)
        values (${org.id}, ${campaign.id}, ${lap.id}, ${contact.id}, ${e164}, ${senderId},
          ${adText}, 'GSM_7BIT', 1, ${route.id}, 'delivered', ${`e2e-dlr-${base}-${i}`},
          ${`e2e${String(base + i).padStart(5, "0")}`}, ${crypto.randomUUID()}, ${text.id},
          ${link.id}, ${`e2e-dlr:${lap.id}:${contact.id}`}, now() - interval '50 minutes',
          now() - interval '49 minutes') returning id`;
      if (!message) throw new Error("message insert failed");
      for (let n = 0; n < clicks; n += 1) {
        await sql`
          insert into clicks (organisation_id, message_id, campaign_id, lap_id, at, device)
          values (${org.id}, ${message.id}, ${campaign.id}, ${lap.id},
            now() - interval '40 minutes', 'mobile')`;
      }
    }
    return { campaignId: campaign.id, campaignName, senderId, adText, linkName };
  } finally {
    await sql.end();
  }
}

/** Remove everything `seedE2eDelivery` created for campaigns whose name starts with `namePrefix`. */
export async function cleanupE2eDelivery(namePrefix: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the delivery e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from campaigns where name like ${`${namePrefix}%`}`;
    await sql`delete from links where name = 'E2E offer'`;
    await sql`delete from contacts where e164 like ${`${DELIVERY_E164_PREFIX}%`}`;
  } finally {
    await sql.end();
  }
}
