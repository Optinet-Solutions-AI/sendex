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

export interface SeededAlert {
  id: string;
  kind: string;
  periodKey: string;
  message: string;
}

/** Period keys of alerts the caps spec seeds start with this, so cleanup can find them. */
export const E2E_ALERT_PERIOD_PREFIX = "e2e-";

/**
 * An open alert of the seeded "external" organisation, as the worker's `raiseAlert` would
 * store it when a daily cap refuses a lap (D3-11). The worker is not running under
 * Playwright, so the row goes in directly; acknowledging it exercises the real action.
 */
export async function seedE2eAlert(input: { kind: string; message: string }): Promise<SeededAlert> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the caps e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    const [org] = await sql<{ id: string }[]>`select id from organisations where slug = 'external'`;
    if (!org) throw new Error("demo seed missing: run pnpm db:seed");
    const periodKey = `${E2E_ALERT_PERIOD_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [row] = await sql<{ id: string }[]>`
      insert into organisation_alerts (organisation_id, kind, period_key, message, details)
      values (${org.id}, ${input.kind}, ${periodKey}, ${input.message}, ${sql.json({ seededBy: "e2e" })})
      returning id`;
    if (!row) throw new Error("alert insert failed");
    return { id: row.id, kind: input.kind, periodKey, message: input.message };
  } finally {
    await sql.end();
  }
}

/** Remove every alert `seedE2eAlert` created. */
export async function cleanupE2eAlerts(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the caps e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from organisation_alerts where period_key like ${`${E2E_ALERT_PERIOD_PREFIX}%`}`;
  } finally {
    await sql.end();
  }
}
