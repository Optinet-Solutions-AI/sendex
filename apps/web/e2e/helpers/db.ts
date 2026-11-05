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

/** Numbers the results spec creates start with this; the other specs use different prefixes. */
export const RESULTS_E164_PREFIX = "+34697";

export interface SeededResults {
  campaignId: string;
  campaignName: string;
  lap405Id: string;
  lap403Id: string;
  /** Straight from SQL over the seeded rows: what the page must show. */
  sql: {
    sent: number;
    delivered: number;
    failed: number;
    clicks: number;
    leads: number;
    sales: number;
    costMicro: number;
    messagesSubmitted405: number;
    clicks405: number;
  };
}

/**
 * A sending campaign of the seeded "external" organisation with the ES list, the "ES Casino"
 * sender id group, one ad text, one tracked link and two laps (routes 405 and 403) whose
 * counters match the messages and clicks written beneath them. Test-only; the worker is not
 * running under Playwright. The 403 lap is left `sending` so the spec can switch it off.
 */
export async function seedE2eResults(namePrefix: string): Promise<SeededResults> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the campaign results e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    const [org] = await sql<{ id: string }[]>`select id from organisations where slug = 'external'`;
    const [list] = await sql<{ id: string }[]>`
      select id from lists where organisation_id = ${org?.id ?? ""} and country = 'ES' limit 1`;
    const [r405] = await sql<{ id: string }[]>`select id from routes where name = '405' limit 1`;
    const [r403] = await sql<{ id: string }[]>`select id from routes where name = '403' limit 1`;
    const [group] = await sql<{ id: string }[]>`
      select id from sid_groups where organisation_id = ${org?.id ?? ""} and name = 'ES Casino' limit 1`;
    if (!org || !list || !r405 || !r403 || !group) {
      throw new Error("demo seed missing: run pnpm db:seed");
    }

    const campaignName = `${namePrefix} ${Date.now()}`;
    const [campaign] = await sql<{ id: string }[]>`
      insert into campaigns (organisation_id, name, country, timezone, status, test_size)
      values (${org.id}, ${campaignName}, 'ES', 'Europe/Madrid', 'sending', 5) returning id`;
    if (!campaign) throw new Error("campaign insert failed");
    await sql`insert into campaign_lists (campaign_id, list_id, organisation_id)
      values (${campaign.id}, ${list.id}, ${org.id})`;
    await sql`insert into campaign_sid_group (campaign_id, sid_group_id, organisation_id)
      values (${campaign.id}, ${group.id}, ${org.id})`;
    const [text] = await sql<{ id: string }[]>`
      insert into ad_texts (organisation_id, campaign_id, text, encoding)
      values (${org.id}, ${campaign.id}, 'E2E results text {{domain}}', 'GSM_7BIT') returning id`;
    const [link] = await sql<{ id: string }[]>`
      insert into links (organisation_id, name, url)
      values (${org.id}, ${`${namePrefix} link`}, 'https://e2e.example/{{dynamic}}') returning id`;
    if (!text || !link) throw new Error("results seed failed");
    await sql`insert into campaign_links (campaign_id, link_id, organisation_id)
      values (${campaign.id}, ${link.id}, ${org.id})`;

    const firstSend = new Date("2026-09-14T10:00:00Z");
    const [lap405] = await sql<{ id: string }[]>`
      insert into laps (organisation_id, campaign_id, list_id, route_id, test_size, status,
        sent, delivered, failed, clicks, leads, sales, cost_micro, rank, started_at, finished_at)
      values (${org.id}, ${campaign.id}, ${list.id}, ${r405.id}, 5, 'done',
        5, 3, 1, 3, 1, 1, 125000, 1, ${firstSend}, ${new Date("2026-09-14T10:30:00Z")})
      returning id`;
    const [lap403] = await sql<{ id: string }[]>`
      insert into laps (organisation_id, campaign_id, list_id, route_id, test_size, status,
        sent, delivered, failed, clicks, leads, sales, cost_micro, rank, started_at)
      values (${org.id}, ${campaign.id}, ${list.id}, ${r403.id}, 5, 'sending',
        4, 2, 2, 1, 0, 0, 100000, 2, ${firstSend})
      returning id`;
    if (!lap405 || !lap403) throw new Error("lap insert failed");

    const plan: Array<{ lapId: string; routeId: string; status: string; clicksAt: number[] }> = [
      { lapId: lap405.id, routeId: r405.id, status: "delivered", clicksAt: [5, 20] },
      { lapId: lap405.id, routeId: r405.id, status: "delivered", clicksAt: [150] },
      { lapId: lap405.id, routeId: r405.id, status: "delivered", clicksAt: [] },
      { lapId: lap405.id, routeId: r405.id, status: "sent", clicksAt: [] },
      { lapId: lap405.id, routeId: r405.id, status: "sent", clicksAt: [] },
      { lapId: lap405.id, routeId: r405.id, status: "failed", clicksAt: [] },
      { lapId: lap403.id, routeId: r403.id, status: "delivered", clicksAt: [40] },
      { lapId: lap403.id, routeId: r403.id, status: "delivered", clicksAt: [] },
      { lapId: lap403.id, routeId: r403.id, status: "sent", clicksAt: [] },
      { lapId: lap403.id, routeId: r403.id, status: "expired", clicksAt: [] },
      { lapId: lap403.id, routeId: r403.id, status: "failed", clicksAt: [] },
    ];
    const stamp = String(Date.now() % 100_000).padStart(5, "0");
    for (const [i, m] of plan.entries()) {
      const e164 = `${RESULTS_E164_PREFIX}${stamp}${i}`;
      const [contact] = await sql<{ id: string }[]>`
        insert into contacts (organisation_id, e164, country) values (${org.id}, ${e164}, 'ES')
        on conflict (organisation_id, e164) do update set country = 'ES' returning id`;
      if (!contact) throw new Error("contact insert failed");
      const [message] = await sql<{ id: string }[]>`
        insert into messages (organisation_id, campaign_id, lap_id, contact_id, e164, sender_id, text,
          encoding, parts, route_id, status, link_id, ad_text_id, idempotency_key, sent_at)
        values (${org.id}, ${campaign.id}, ${m.lapId}, ${contact.id}, ${e164}, 'E2ESID',
          'E2E results text', 'GSM_7BIT', 1, ${m.routeId}, ${m.status}::message_status, ${link.id},
          ${text.id}, ${`e2e-results:${campaign.id}:${i}`},
          ${new Date(firstSend.getTime() + i * 60_000)})
        returning id`;
      if (!message) throw new Error("message insert failed");
      for (const minutes of m.clicksAt) {
        await sql`insert into clicks (organisation_id, message_id, campaign_id, lap_id, at)
          values (${org.id}, ${message.id}, ${campaign.id}, ${m.lapId},
            ${new Date(firstSend.getTime() + minutes * 60_000)})`;
      }
    }

    const [totals] = await sql<
      {
        sent: string;
        delivered: string;
        failed: string;
        clicks: string;
        leads: string;
        sales: string;
        cost: string;
      }[]
    >`select sum(sent) as sent, sum(delivered) as delivered, sum(failed) as failed,
        sum(clicks) as clicks, sum(leads) as leads, sum(sales) as sales, sum(cost_micro) as cost
      from laps where campaign_id = ${campaign.id}`;
    const [m405] = await sql<{ n: string }[]>`select count(*) as n from messages
      where route_id = ${r405.id} and campaign_id = ${campaign.id}
        and status in ('sent', 'delivered', 'expired')`;
    const [c405] = await sql<{ n: string }[]>`select count(*) as n from clicks c
      join messages m on m.id = c.message_id
      where c.campaign_id = ${campaign.id} and m.route_id = ${r405.id}`;
    if (!totals || !m405 || !c405) throw new Error("totals query failed");
    return {
      campaignId: campaign.id,
      campaignName,
      lap405Id: lap405.id,
      lap403Id: lap403.id,
      sql: {
        sent: Number(totals.sent),
        delivered: Number(totals.delivered),
        failed: Number(totals.failed),
        clicks: Number(totals.clicks),
        leads: Number(totals.leads),
        sales: Number(totals.sales),
        costMicro: Number(totals.cost),
        messagesSubmitted405: Number(m405.n),
        clicks405: Number(c405.n),
      },
    };
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

/** Remove everything `seedE2eResults` created for campaigns whose name starts with `namePrefix`. */
export async function cleanupE2eResults(namePrefix: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the campaign results e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from campaigns where name like ${`${namePrefix}%`}`;
    await sql`delete from links where name like ${`${namePrefix}%`}`;
    // The results and list specs share the number prefix and run in parallel: only drop
    // contacts no message refers to any more.
    await sql`delete from contacts where e164 like ${`${RESULTS_E164_PREFIX}%`}
      and not exists (select 1 from messages m where m.contact_id = contacts.id)`;
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

export interface SeededControlCampaign {
  campaignId: string;
  campaignName: string;
  lapId: string;
}

/**
 * A campaign of the seeded "external" organisation with one queued lap on the seeded ES list
 * and route 405, either `sending` (as the campaign page leaves it after Send) or `scheduled`
 * for `scheduledAt`. The worker is not running under Playwright, so the lap stays queued and
 * the pause / resume / stop / reschedule spec only exercises the web side. Test-only.
 */
export async function seedE2eControlCampaign(
  namePrefix: string,
  options: { status: "sending" } | { status: "scheduled"; scheduledAt: Date },
): Promise<SeededControlCampaign> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the campaign control e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    const [org] = await sql<{ id: string }[]>`select id from organisations where slug = 'external'`;
    const [list] = await sql<{ id: string }[]>`
      select id from lists where organisation_id = ${org?.id ?? ""} and country = 'ES' limit 1`;
    const [route] = await sql<{ id: string }[]>`select id from routes where name = '405' limit 1`;
    if (!org || !list || !route) throw new Error("demo seed missing: run pnpm db:seed");
    const campaignName = `${namePrefix} ${Date.now()}`;
    const scheduledAt = options.status === "scheduled" ? options.scheduledAt : null;
    const [campaign] = await sql<{ id: string }[]>`
      insert into campaigns (organisation_id, name, country, timezone, status, scheduled_at)
      values (${org.id}, ${campaignName}, 'ES', 'Europe/Madrid', ${options.status}, ${scheduledAt})
      returning id`;
    if (!campaign) throw new Error("campaign insert failed");
    const [lap] = await sql<{ id: string }[]>`
      insert into laps (organisation_id, campaign_id, list_id, route_id, test_size, status)
      values (${org.id}, ${campaign.id}, ${list.id}, ${route.id}, 10, 'queued') returning id`;
    if (!lap) throw new Error("lap insert failed");
    return { campaignId: campaign.id, campaignName, lapId: lap.id };
  } finally {
    await sql.end();
  }
}

/** Remove the campaigns `seedE2eControlCampaign` created (laps cascade; audit rows stay). */
export async function cleanupE2eControlCampaigns(namePrefix: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the campaign control e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from campaigns where name like ${`${namePrefix}%`}`;
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

/** Remove the API tokens the api-tokens spec created (names starting with `namePrefix`). */
export async function cleanupE2eApiTokens(namePrefix: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the api-tokens e2e spec");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from api_tokens where name like ${`${namePrefix}%`}`;
  } finally {
    await sql.end();
  }
}
