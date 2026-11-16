import { execSync } from "node:child_process";
import { resolve } from "node:path";
import postgres from "postgres";

/** The repository root: this file is apps/web/e2e/helpers/demo.ts. */
const ROOT = resolve(__dirname, "..", "..", "..", "..");

/**
 * Make sure the demo activity (D5-02) is in the local database: the KPI specs read its lists,
 * offers and campaigns. Runs `pnpm db:seed:activity`, which changes nothing when the rows are
 * already there and refuses a database that is not on this machine.
 */
export function ensureDemoActivity(): void {
  execSync("pnpm db:seed:activity", { cwd: ROOT, stdio: "pipe", env: process.env });
}

/**
 * The month of the latest demo send. The demo sends are dated relative to the day they were
 * seeded, so a spec that looks at one month asks which month that is.
 */
export async function latestDemoMonth(): Promise<{ year: number; month: number }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the KPI e2e specs");
  const sql = postgres(url, { max: 1 });
  try {
    const [row] = await sql`
      select max(sent_at) as at from messages where idempotency_key like 'seed-activity:%'`;
    if (!row?.at) throw new Error("The demo activity is not seeded");
    const at = new Date(row.at as string);
    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
  } finally {
    await sql.end();
  }
}

/** Remove the draft campaigns the campaign creator made (D5-07), so its spec can run again. */
export async function deletePlannedCampaigns(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the KPI e2e specs");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from campaigns where planned_for is not null and status = 'draft'`;
  } finally {
    await sql.end();
  }
}

/**
 * Two draft campaigns planned for `day` in the demo organisation, for the daily plan spec
 * (D5-08): Trixino to UK_ZEN_3 on route 724 and Rolling Slots to ES_DIM_1 on route 400. Their
 * names start with `namePrefix`. Needs the demo activity.
 */
export async function seedE2ePlan(namePrefix: string, day: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the KPI e2e specs");
  const sql = postgres(url, { max: 1 });
  try {
    const [org] = await sql`select id from organisations where slug = 'external'`;
    if (!org) throw new Error("The demo organisation is missing");
    const plans = [
      { offer: "Trixino", list: "UK_ZEN_3", route: "724", country: "GB", zone: "Europe/London" },
      {
        offer: "Rolling Slots",
        list: "ES_DIM_1",
        route: "400",
        country: "ES",
        zone: "Europe/Madrid",
      },
    ];
    for (const plan of plans) {
      const [campaign] = await sql`
        insert into campaigns (organisation_id, name, country, timezone, planned_for)
        values (${org.id}, ${`${namePrefix} ${plan.offer} to ${plan.list}`}, ${plan.country},
                ${plan.zone}, ${day}::date)
        returning id`;
      if (!campaign) throw new Error("seedE2ePlan: no campaign row");
      await sql`
        insert into campaign_lists (campaign_id, list_id, organisation_id)
        select ${campaign.id}, id, ${org.id} from lists
        where organisation_id = ${org.id} and name = ${plan.list}`;
      await sql`
        insert into campaign_links (campaign_id, link_id, organisation_id)
        select ${campaign.id}, id, ${org.id} from links
        where organisation_id = ${org.id} and name = ${plan.offer}`;
      await sql`
        insert into campaign_routes (campaign_id, route_id, organisation_id, position)
        select ${campaign.id}, id, ${org.id}, 0 from routes
        where organisation_id is null and name = ${plan.route}`;
    }
  } finally {
    await sql.end();
  }
}

/** Remove the campaigns `seedE2ePlan` made and put the daily target back to "not set". */
export async function cleanupE2ePlan(namePrefix: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to run the KPI e2e specs");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`delete from campaigns where name like ${`${namePrefix}%`}`;
    await sql`
      update organisation_settings set daily_send_target = null
      where organisation_id = (select id from organisations where slug = 'external')`;
  } finally {
    await sql.end();
  }
}
