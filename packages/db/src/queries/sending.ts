import { rankLaps } from "@sendex/core";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  adTexts,
  auditLog,
  campaignLinks,
  campaignSidGroup,
  type campaignStatusEnum,
  campaigns,
  type contactReuseEnum,
  contacts,
  laps,
  ledgerEntries,
  links,
  listMembers,
  lists,
  messages,
  routePrices,
  routes,
  senderIds,
  suppressions,
} from "../schema/index.js";
import type { Db } from "../types.js";
import { getBalanceMicro } from "./ledger.js";

/**
 * Everything the sending engine (apps/worker/src/send) reads and writes. The worker
 * only talks to the database through this store, so the send loop can be unit-tested
 * against an in-memory fake and the SQL against PGlite (sending.test.ts).
 *
 * Money rules (AGENTS.md rule 6): a message is inserted with its debit in one
 * transaction; a failed or cancelled message gets a refund derived from its debit
 * row; every ledger entry carries an idempotency key, so replays change nothing.
 */

export type CampaignStatus = (typeof campaignStatusEnum.enumValues)[number];
export type ContactReuse = (typeof contactReuseEnum.enumValues)[number];

export interface LapRow {
  id: string;
  organisationId: string;
  campaignId: string;
  listId: string;
  routeId: string;
  testSize: number;
  status: "queued" | "sending" | "done" | "cancelled";
  sent: number;
  failed: number;
  costMicro: bigint;
}

export interface LapContext {
  lap: LapRow;
  campaign: { id: string; status: CampaignStatus; contactReuse: ContactReuse };
  list: { id: string; country: string };
  route: {
    id: string;
    provider: string;
    name: string;
    active: boolean;
    config: Record<string, unknown>;
  };
  /** Active sender ids of the campaign's group, in a stable order. */
  senderIds: string[];
  /** Active texts of the campaign ordered by position. */
  texts: Array<{ id: string; text: string }>;
  /** First active link of the campaign, if any. */
  link: { id: string; url: string } | null;
  /** Current route price for the list's country in micro-EUR per part, null when unpriced. */
  priceMicro: bigint | null;
}

export interface EligibilityInput {
  organisationId: string;
  listId: string;
  campaignId: string;
  contactReuse: ContactReuse;
}

export interface EligibleMember {
  memberId: string;
  contactId: string;
  e164: string;
  firstName: string | null;
}

export interface NewMessageInput {
  contactId: string;
  e164: string;
  senderId: string;
  text: string;
  encoding: string;
  parts: number;
  shortCode: string | null;
  dynamicId: string;
}

export interface QueuedMessage {
  id: string;
  contactId: string;
  e164: string;
  senderId: string;
  text: string;
  encoding: string;
  parts: number;
  idempotencyKey: string;
}

export type MessageOutcome =
  | {
      messageId: string;
      contactId: string;
      parts: number;
      status: "sent";
      providerMessageId: string;
    }
  | { messageId: string; contactId: string; parts: number; status: "failed"; errorCode: string };

export interface ClaimAndCreateInput {
  lap: Pick<LapRow, "id" | "organisationId" | "campaignId" | "listId" | "routeId">;
  eligibility: EligibilityInput;
  limit: number;
  priceMicro: bigint;
  /** Turn the claimed members into messages (rendering, rotation). Runs inside the transaction. */
  build: (members: EligibleMember[]) => NewMessageInput[];
}

export interface ApplyOutcomesInput {
  lap: Pick<LapRow, "id" | "organisationId" | "listId">;
  priceMicro: bigint;
  outcomes: MessageOutcome[];
}

export interface ClaimedLap {
  id: string;
  organisationId: string;
  campaignId: string;
}

export interface CampaignLapRow {
  id: string;
  status: LapRow["status"];
  testSize: number;
  sent: number;
  failed: number;
}

export interface CreateQueuedLapInput {
  organisationId: string;
  campaignId: string;
  listId: string;
  routeId: string;
  testSize: number;
  /** Stored on the audit row (`lap.create`), e.g. the mode and price used. */
  details: Record<string, unknown>;
}

export interface LapPlanningContext {
  campaign: { id: string; status: CampaignStatus; contactReuse: ContactReuse } | null;
  list: { id: string; country: string } | null;
  route: { id: string; provider: string; active: boolean } | null;
}

export interface SendingStore {
  loadLapContext(lapId: string): Promise<LapContext | null>;
  getCampaignStatus(campaignId: string): Promise<CampaignStatus | null>;
  getBalanceMicro(organisationId: string): Promise<bigint>;
  getCurrentPriceMicro(routeId: string, country: string): Promise<bigint | null>;
  markLapStarted(lapId: string): Promise<void>;
  countLapMessages(lapId: string): Promise<number>;
  listQueuedMessages(lapId: string): Promise<QueuedMessage[]>;
  selectEligibleMembers(input: EligibilityInput, limit: number): Promise<EligibleMember[]>;
  countEligibleMembers(input: EligibilityInput): Promise<number>;
  /** Lock up to `limit` eligible members, insert their messages and debits, return the messages. */
  claimAndCreateMessages(input: ClaimAndCreateInput): Promise<QueuedMessage[]>;
  /** Record provider outcomes: statuses, member sent_at, refunds for failures, lap counters. */
  applyOutcomes(input: ApplyOutcomesInput): Promise<void>;
  /** Cancel the lap and its queued messages (refunding them), with an audit row. Idempotent. */
  cancelLap(input: { lapId: string; organisationId: string; reason: string }): Promise<void>;
  finishLap(input: { lapId: string; listId: string }): Promise<void>;
  rankCampaignLaps(campaignId: string): Promise<void>;
  /** Move every dispatchable queued lap to `sending` and return them. */
  claimQueuedLaps(now: Date): Promise<ClaimedLap[]>;
  listCampaignLaps(organisationId: string, campaignId: string): Promise<CampaignLapRow[]>;
  createQueuedLap(input: CreateQueuedLapInput): Promise<LapRow>;
  loadLapPlanningContext(input: {
    organisationId: string;
    campaignId: string;
    listId: string;
    routeId: string;
  }): Promise<LapPlanningContext>;
}

const toNumber = (value: unknown): number => Number(value);

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  throw new Error(`cannot convert ${String(value)} to bigint`);
}

const lapColumns = {
  id: laps.id,
  organisationId: laps.organisationId,
  campaignId: laps.campaignId,
  listId: laps.listId,
  routeId: laps.routeId,
  testSize: laps.testSize,
  status: laps.status,
  sent: laps.sent,
  failed: laps.failed,
  costMicro: laps.costMicro,
};

const queuedMessageColumns = {
  id: messages.id,
  contactId: messages.contactId,
  e164: messages.e164,
  senderId: messages.senderId,
  text: messages.text,
  encoding: messages.encoding,
  parts: messages.parts,
  idempotencyKey: messages.idempotencyKey,
};

const ACTIVE_MESSAGE_STATUSES = ["queued", "sent", "delivered", "failed", "expired"] as const;

/**
 * The eligibility rules, as one query over list_members joined to contacts:
 *  - member not bad, never sent or flushed after the last send;
 *  - number not in the organisation's suppressions;
 *  - no live message for the contact in this campaign (any lap, any route);
 *  - account_wide reuse: no sent/delivered message for the contact anywhere in the
 *    organisation since the member's last flush.
 */
function eligibilityWhere(db: Db, input: EligibilityInput): SQL | undefined {
  const sinceFlush = or(
    isNull(listMembers.flushedAt),
    gt(sql`coalesce(${messages.sentAt}, ${messages.createdAt})`, listMembers.flushedAt),
  );
  const reuseClause =
    input.contactReuse === "account_wide"
      ? notExists(
          db
            .select({ one: sql`1` })
            .from(messages)
            .where(
              and(
                eq(messages.organisationId, input.organisationId),
                eq(messages.contactId, listMembers.contactId),
                inArray(messages.status, ["sent", "delivered"]),
                sinceFlush,
              ),
            ),
        )
      : undefined;
  return and(
    eq(listMembers.organisationId, input.organisationId),
    eq(listMembers.listId, input.listId),
    eq(listMembers.bad, false),
    or(isNull(listMembers.sentAt), gt(listMembers.flushedAt, listMembers.sentAt)),
    notExists(
      db
        .select({ one: sql`1` })
        .from(suppressions)
        .where(
          and(
            eq(suppressions.organisationId, input.organisationId),
            eq(suppressions.e164, contacts.e164),
          ),
        ),
    ),
    notExists(
      db
        .select({ one: sql`1` })
        .from(messages)
        .where(
          and(
            eq(messages.campaignId, input.campaignId),
            eq(messages.contactId, listMembers.contactId),
            inArray(messages.status, [...ACTIVE_MESSAGE_STATUSES]),
          ),
        ),
    ),
    reuseClause,
  );
}

function eligibleMembersQuery(db: Db, input: EligibilityInput, limit: number) {
  return db
    .select({
      memberId: listMembers.id,
      contactId: contacts.id,
      e164: contacts.e164,
      firstName: contacts.firstName,
    })
    .from(listMembers)
    .innerJoin(contacts, eq(contacts.id, listMembers.contactId))
    .where(eligibilityWhere(db, input))
    .orderBy(asc(listMembers.id))
    .limit(limit);
}

async function currentPriceMicro(db: Db, routeId: string, country: string, now: Date) {
  const [row] = await db
    .select({ priceMicro: routePrices.priceMicro })
    .from(routePrices)
    .where(
      and(
        eq(routePrices.routeId, routeId),
        eq(routePrices.country, country),
        lte(routePrices.validFrom, now),
      ),
    )
    .orderBy(desc(routePrices.validFrom))
    .limit(1);
  return row?.priceMicro ?? null;
}

/**
 * Insert a refund for every debit of the given messages that has not been refunded yet.
 * Derived from the debit rows so the refund always matches what was charged.
 */
async function refundMessages(
  db: Db,
  organisationId: string,
  messageIds: readonly string[],
  note: string,
): Promise<void> {
  if (messageIds.length === 0) return;
  const ids = sql.join(
    messageIds.map((id) => sql`${id}`),
    sql`, `,
  );
  await db.execute(sql`
    insert into ${ledgerEntries}
      (organisation_id, kind, amount_micro, reference_type, reference_id, idempotency_key, note)
    select ${ledgerEntries.organisationId}, 'refund', -${ledgerEntries.amountMicro}, 'message',
      ${ledgerEntries.referenceId}, 'refund:' || ${ledgerEntries.referenceId}, ${note}
    from ${ledgerEntries}
    where ${ledgerEntries.organisationId} = ${organisationId}
      and ${ledgerEntries.kind} = 'debit'
      and ${ledgerEntries.referenceType} = 'message'
      and ${ledgerEntries.referenceId} in (${ids})
    on conflict (idempotency_key) do nothing
  `);
}

export function createSendingStore(db: Db): SendingStore {
  return {
    async loadLapContext(lapId) {
      const [lap] = await db.select(lapColumns).from(laps).where(eq(laps.id, lapId));
      if (!lap) return null;
      const [campaign, list, route, sids, texts, link, priceMicro] = await Promise.all([
        db
          .select({
            id: campaigns.id,
            status: campaigns.status,
            contactReuse: campaigns.contactReuse,
          })
          .from(campaigns)
          .where(eq(campaigns.id, lap.campaignId))
          .then((rows) => rows[0] ?? null),
        db
          .select({ id: lists.id, country: lists.country })
          .from(lists)
          .where(eq(lists.id, lap.listId))
          .then((rows) => rows[0] ?? null),
        db
          .select({
            id: routes.id,
            provider: routes.provider,
            name: routes.name,
            active: routes.active,
            config: routes.config,
          })
          .from(routes)
          .where(eq(routes.id, lap.routeId))
          .then((rows) => rows[0] ?? null),
        db
          .select({ value: senderIds.value })
          .from(campaignSidGroup)
          .innerJoin(senderIds, eq(senderIds.sidGroupId, campaignSidGroup.sidGroupId))
          .where(and(eq(campaignSidGroup.campaignId, lap.campaignId), eq(senderIds.active, true)))
          .orderBy(asc(senderIds.value)),
        db
          .select({ id: adTexts.id, text: adTexts.text })
          .from(adTexts)
          .where(and(eq(adTexts.campaignId, lap.campaignId), eq(adTexts.active, true)))
          .orderBy(asc(adTexts.position), asc(adTexts.id)),
        db
          .select({ id: links.id, url: links.url })
          .from(campaignLinks)
          .innerJoin(links, eq(links.id, campaignLinks.linkId))
          .where(
            and(
              eq(campaignLinks.campaignId, lap.campaignId),
              eq(campaignLinks.active, true),
              eq(links.active, true),
            ),
          )
          .orderBy(asc(links.createdAt), asc(links.id))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        db
          .select({ country: lists.country })
          .from(lists)
          .where(eq(lists.id, lap.listId))
          .then((rows) =>
            rows[0] ? currentPriceMicro(db, lap.routeId, rows[0].country, new Date()) : null,
          ),
      ]);
      if (!campaign || !list || !route) return null;
      return {
        lap,
        campaign,
        list,
        route,
        senderIds: sids.map((s) => s.value),
        texts,
        link,
        priceMicro,
      };
    },

    async getCampaignStatus(campaignId) {
      const [row] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      return row?.status ?? null;
    },

    getBalanceMicro: (organisationId) => getBalanceMicro(db, organisationId),

    getCurrentPriceMicro: (routeId, country) => currentPriceMicro(db, routeId, country, new Date()),

    async markLapStarted(lapId) {
      await db
        .update(laps)
        .set({ startedAt: sql`coalesce(${laps.startedAt}, now())` })
        .where(eq(laps.id, lapId));
    },

    async countLapMessages(lapId) {
      const [row] = await db
        .select({ count: sql`count(*)`.mapWith(toNumber) })
        .from(messages)
        .where(eq(messages.lapId, lapId));
      return row?.count ?? 0;
    },

    listQueuedMessages(lapId) {
      return db
        .select(queuedMessageColumns)
        .from(messages)
        .where(and(eq(messages.lapId, lapId), eq(messages.status, "queued")))
        .orderBy(asc(messages.createdAt), asc(messages.id));
    },

    selectEligibleMembers: (input, limit) => eligibleMembersQuery(db, input, limit),

    async countEligibleMembers(input) {
      const [row] = await db
        .select({ count: sql`count(*)`.mapWith(toNumber) })
        .from(listMembers)
        .innerJoin(contacts, eq(contacts.id, listMembers.contactId))
        .where(eligibilityWhere(db, input));
      return row?.count ?? 0;
    },

    async claimAndCreateMessages({ lap, eligibility, limit, priceMicro, build }) {
      if (limit <= 0) return [];
      return db.transaction(async (tx) => {
        const members = await eligibleMembersQuery(tx, eligibility, limit).for("update", {
          of: listMembers,
          skipLocked: true,
        });
        if (members.length === 0) return [];
        const built = build(members);
        if (built.length === 0) return [];
        const created = await tx
          .insert(messages)
          .values(
            built.map((m) => ({
              organisationId: lap.organisationId,
              campaignId: lap.campaignId,
              lapId: lap.id,
              contactId: m.contactId,
              routeId: lap.routeId,
              e164: m.e164,
              senderId: m.senderId,
              text: m.text,
              encoding: m.encoding,
              parts: m.parts,
              shortCode: m.shortCode,
              dynamicId: m.dynamicId,
              status: "queued" as const,
              idempotencyKey: `${lap.id}:${m.contactId}`,
            })),
          )
          .onConflictDoNothing({ target: messages.idempotencyKey })
          .returning(queuedMessageColumns);
        if (created.length > 0) {
          await tx
            .insert(ledgerEntries)
            .values(
              created.map((m) => ({
                organisationId: lap.organisationId,
                kind: "debit" as const,
                amountMicro: -(BigInt(m.parts) * priceMicro),
                referenceType: "message",
                referenceId: m.id,
                idempotencyKey: `msg:${m.id}`,
                note: `lap ${lap.id}`,
              })),
            )
            .onConflictDoNothing({ target: ledgerEntries.idempotencyKey });
        }
        return created;
      });
    },

    async applyOutcomes({ lap, priceMicro, outcomes }) {
      if (outcomes.length === 0) return;
      await db.transaction(async (tx) => {
        const sentIds: string[] = [];
        const sentContacts: string[] = [];
        const failedIds: string[] = [];
        let costMicro = 0n;
        for (const o of outcomes) {
          if (o.status === "sent") {
            const [row] = await tx
              .update(messages)
              .set({ status: "sent", providerMessageId: o.providerMessageId, sentAt: sql`now()` })
              .where(and(eq(messages.id, o.messageId), eq(messages.status, "queued")))
              .returning({ id: messages.id });
            if (!row) continue;
            sentIds.push(o.messageId);
            sentContacts.push(o.contactId);
            costMicro += BigInt(o.parts) * priceMicro;
          } else {
            const [row] = await tx
              .update(messages)
              .set({ status: "failed", errorCode: o.errorCode })
              .where(and(eq(messages.id, o.messageId), eq(messages.status, "queued")))
              .returning({ id: messages.id });
            if (row) failedIds.push(o.messageId);
          }
        }
        if (sentContacts.length > 0) {
          await tx
            .update(listMembers)
            .set({ sentAt: sql`now()` })
            .where(
              and(eq(listMembers.listId, lap.listId), inArray(listMembers.contactId, sentContacts)),
            );
        }
        await refundMessages(tx, lap.organisationId, failedIds, "send failed");
        if (sentIds.length > 0 || failedIds.length > 0) {
          await tx
            .update(laps)
            .set({
              sent: sql`${laps.sent} + ${sentIds.length}`,
              failed: sql`${laps.failed} + ${failedIds.length}`,
              costMicro: sql`${laps.costMicro} + ${costMicro}`,
            })
            .where(eq(laps.id, lap.id));
        }
      });
    },

    async cancelLap({ lapId, organisationId, reason }) {
      await db.transaction(async (tx) => {
        const cancelled = await tx
          .update(messages)
          .set({ status: "cancelled" })
          .where(and(eq(messages.lapId, lapId), eq(messages.status, "queued")))
          .returning({ id: messages.id });
        await refundMessages(
          tx,
          organisationId,
          cancelled.map((m) => m.id),
          "cancelled",
        );
        const [lap] = await tx
          .update(laps)
          .set({ status: "cancelled", finishedAt: sql`now()` })
          .where(and(eq(laps.id, lapId), inArray(laps.status, ["queued", "sending"])))
          .returning({ id: laps.id });
        if (lap) {
          await tx.insert(auditLog).values({
            organisationId,
            action: "lap.cancel",
            targetType: "lap",
            targetId: lapId,
            details: { reason, cancelledMessages: cancelled.length },
          });
        }
      });
    },

    async finishLap({ lapId, listId }) {
      await db.transaction(async (tx) => {
        await tx
          .update(laps)
          .set({ status: "done", finishedAt: sql`now()` })
          .where(and(eq(laps.id, lapId), eq(laps.status, "sending")));
        await tx.update(lists).set({ lastSentAt: sql`now()` }).where(eq(lists.id, listId));
      });
    },

    async rankCampaignLaps(campaignId) {
      const rows = await db
        .select({
          id: laps.id,
          sent: laps.sent,
          clicks: laps.clicks,
          costMicro: laps.costMicro,
          leads: laps.leads,
          sales: laps.sales,
        })
        .from(laps)
        .where(and(eq(laps.campaignId, campaignId), eq(laps.status, "done")));
      const ranked = rankLaps(rows.map((r) => ({ ...r, costMicro: Number(r.costMicro) })));
      await db.transaction(async (tx) => {
        for (const lap of ranked) {
          await tx.update(laps).set({ rank: lap.rank }).where(eq(laps.id, lap.id));
        }
      });
    },

    claimQueuedLaps(now) {
      return db
        .update(laps)
        .set({ status: "sending" })
        .where(
          and(
            eq(laps.status, "queued"),
            inArray(
              laps.campaignId,
              db
                .select({ id: campaigns.id })
                .from(campaigns)
                .where(
                  and(
                    notInArray(campaigns.status, ["paused", "stopped"]),
                    or(isNull(campaigns.scheduledAt), lte(campaigns.scheduledAt, now)),
                  ),
                ),
            ),
          ),
        )
        .returning({
          id: laps.id,
          organisationId: laps.organisationId,
          campaignId: laps.campaignId,
        });
    },

    listCampaignLaps(organisationId, campaignId) {
      return db
        .select({
          id: laps.id,
          status: laps.status,
          testSize: laps.testSize,
          sent: laps.sent,
          failed: laps.failed,
        })
        .from(laps)
        .where(and(eq(laps.organisationId, organisationId), eq(laps.campaignId, campaignId)))
        .orderBy(asc(laps.createdAt), asc(laps.id));
    },

    async createQueuedLap(input) {
      return db.transaction(async (tx) => {
        const [lap] = await tx
          .insert(laps)
          .values({
            organisationId: input.organisationId,
            campaignId: input.campaignId,
            listId: input.listId,
            routeId: input.routeId,
            testSize: input.testSize,
            status: "queued",
          })
          .returning(lapColumns);
        if (!lap) throw new Error("lap insert returned no row");
        await tx.insert(auditLog).values({
          organisationId: input.organisationId,
          action: "lap.create",
          targetType: "lap",
          targetId: lap.id,
          details: input.details,
        });
        return { ...lap, costMicro: toBigInt(lap.costMicro) };
      });
    },

    async loadLapPlanningContext({ organisationId, campaignId, listId, routeId }) {
      const [campaign, list, route] = await Promise.all([
        db
          .select({
            id: campaigns.id,
            status: campaigns.status,
            contactReuse: campaigns.contactReuse,
          })
          .from(campaigns)
          .where(and(eq(campaigns.id, campaignId), eq(campaigns.organisationId, organisationId)))
          .then((rows) => rows[0] ?? null),
        db
          .select({ id: lists.id, country: lists.country })
          .from(lists)
          .where(and(eq(lists.id, listId), eq(lists.organisationId, organisationId)))
          .then((rows) => rows[0] ?? null),
        db
          .select({ id: routes.id, provider: routes.provider, active: routes.active })
          .from(routes)
          .where(
            and(
              eq(routes.id, routeId),
              or(isNull(routes.organisationId), eq(routes.organisationId, organisationId)),
            ),
          )
          .then((rows) => rows[0] ?? null),
      ]);
      return { campaign, list, route };
    },
  };
}
