import type {
  CampaignStatus,
  LapContext,
  QueuedMessage,
  SendingLapRow,
  SendingStore,
} from "@sendex/db";

/**
 * In-memory `SendingStore` for unit tests of the send loop. Mirrors the SQL rules
 * closely enough: eligibility, idempotent inserts, debits and refunds, lap counters.
 * The real queries are covered by packages/db/src/queries/sending.test.ts.
 */

export interface FakeMember {
  contactId: string;
  e164: string;
  firstName: string | null;
  bad?: boolean;
  sentAt?: Date | null;
  suppressed?: boolean;
}

export interface FakeMessage extends QueuedMessage {
  campaignId: string;
  lapId: string;
  status: "queued" | "sent" | "delivered" | "failed" | "cancelled";
  providerMessageId: string | null;
  errorCode: string | null;
  shortCode: string | null;
  dynamicId: string;
}

export interface FakeLedgerEntry {
  kind: "deposit" | "debit" | "refund";
  amountMicro: bigint;
  referenceId: string | null;
  idempotencyKey: string;
}

export interface FakeAudit {
  action: string;
  targetId: string;
  details: Record<string, unknown>;
}

export interface FakeStoreOptions {
  ctx: LapContext;
  members: FakeMember[];
  /** Opening deposit. */
  balanceMicro: bigint;
  campaignStatus?: CampaignStatus;
}

export interface FakeStore extends SendingStore {
  lap: SendingLapRow & { startedAt: Date | null; finishedAt: Date | null };
  campaignStatus: CampaignStatus;
  members: FakeMember[];
  messages: FakeMessage[];
  ledger: FakeLedgerEntry[];
  audits: FakeAudit[];
  rankedCampaigns: string[];
  calls: string[];
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function createFakeStore(options: FakeStoreOptions): FakeStore {
  const lap: FakeStore["lap"] = { ...options.ctx.lap, startedAt: null, finishedAt: null };
  const ledger: FakeLedgerEntry[] = [
    {
      kind: "deposit",
      amountMicro: options.balanceMicro,
      referenceId: null,
      idempotencyKey: "dep",
    },
  ];
  const messages: FakeMessage[] = [];
  const audits: FakeAudit[] = [];
  const calls: string[] = [];

  function eligible(contactReuse: LapContext["campaign"]["contactReuse"]) {
    return options.members.filter(
      (m) =>
        !m.bad &&
        !m.suppressed &&
        (m.sentAt ?? null) === null &&
        !messages.some(
          (x) =>
            x.contactId === m.contactId &&
            x.status !== "cancelled" &&
            (contactReuse === "account_wide" || x.campaignId === lap.campaignId),
        ),
    );
  }

  function refund(ids: string[]): void {
    for (const id of ids) {
      const debit = ledger.find((e) => e.kind === "debit" && e.referenceId === id);
      const key = `refund:${id}`;
      if (!debit || ledger.some((e) => e.idempotencyKey === key)) continue;
      ledger.push({
        kind: "refund",
        amountMicro: -debit.amountMicro,
        referenceId: id,
        idempotencyKey: key,
      });
    }
  }

  const store: FakeStore = {
    lap,
    campaignStatus: options.campaignStatus ?? "sending",
    members: options.members,
    messages,
    ledger,
    audits,
    rankedCampaigns: [],
    calls,

    async loadLapContext(lapId) {
      calls.push("loadLapContext");
      if (lapId !== lap.id) return null;
      return { ...options.ctx, lap: { ...lap } };
    },
    async getCampaignStatus() {
      return store.campaignStatus;
    },
    async getBalanceMicro() {
      return ledger.reduce((sum, e) => sum + e.amountMicro, 0n);
    },
    async getCurrentPriceMicro() {
      return options.ctx.priceMicro;
    },
    async markLapStarted() {
      lap.startedAt ??= new Date();
    },
    async countLapMessages(lapId) {
      return messages.filter((m) => m.lapId === lapId).length;
    },
    async listQueuedMessages(lapId) {
      return messages
        .filter((m) => m.lapId === lapId && m.status === "queued")
        .map((m) => ({ ...m }));
    },
    async selectEligibleMembers(input, limit) {
      return eligible(input.contactReuse)
        .slice(0, limit)
        .map((m) => ({ memberId: `member-${m.contactId}`, ...m }));
    },
    async countEligibleMembers(input) {
      return eligible(input.contactReuse).length;
    },
    async countSkipReasons() {
      const bad = options.members.filter((m) => m.bad).length;
      const alreadySent = options.members.filter(
        (m) => !m.bad && (m.sentAt ?? null) !== null,
      ).length;
      const suppressed = options.members.filter(
        (m) => !m.bad && (m.sentAt ?? null) === null && m.suppressed,
      ).length;
      return { bad, alreadySent, suppressed, reused: 0 };
    },
    async claimAndCreateMessages({ lap: l, eligibility, limit, priceMicro, build }) {
      calls.push("claimAndCreateMessages");
      const members = await store.selectEligibleMembers(eligibility, limit);
      if (members.length === 0) return [];
      const created: QueuedMessage[] = [];
      for (const m of build(members)) {
        const idempotencyKey = `${l.id}:${m.contactId}`;
        if (messages.some((x) => x.idempotencyKey === idempotencyKey)) continue;
        const row: FakeMessage = {
          id: nextId("msg"),
          campaignId: l.campaignId,
          lapId: l.id,
          contactId: m.contactId,
          e164: m.e164,
          senderId: m.senderId,
          text: m.text,
          encoding: m.encoding,
          parts: m.parts,
          status: "queued",
          providerMessageId: null,
          errorCode: null,
          shortCode: m.shortCode,
          dynamicId: m.dynamicId,
          idempotencyKey,
        };
        messages.push(row);
        ledger.push({
          kind: "debit",
          amountMicro: -(BigInt(m.parts) * priceMicro),
          referenceId: row.id,
          idempotencyKey: `msg:${row.id}`,
        });
        created.push({ ...row });
      }
      return created;
    },
    async applyOutcomes({ priceMicro, outcomes }) {
      calls.push("applyOutcomes");
      const failedIds: string[] = [];
      for (const o of outcomes) {
        const row = messages.find((m) => m.id === o.messageId && m.status === "queued");
        if (!row) continue;
        if (o.status === "sent") {
          row.status = "sent";
          row.providerMessageId = o.providerMessageId;
          const member = options.members.find((m) => m.contactId === o.contactId);
          if (member) member.sentAt = new Date();
          lap.sent += 1;
          lap.costMicro += BigInt(o.parts) * priceMicro;
        } else {
          row.status = "failed";
          row.errorCode = o.errorCode;
          failedIds.push(row.id);
          lap.failed += 1;
        }
      }
      refund(failedIds);
    },
    async cancelLap({ lapId, reason }) {
      calls.push("cancelLap");
      const cancelled = messages.filter((m) => m.lapId === lapId && m.status === "queued");
      for (const m of cancelled) m.status = "cancelled";
      refund(cancelled.map((m) => m.id));
      if (lap.status === "queued" || lap.status === "sending") {
        lap.status = "cancelled";
        lap.finishedAt = new Date();
        audits.push({ action: "lap.cancel", targetId: lapId, details: { reason } });
      }
    },
    async finishLap({ lapId, details }) {
      calls.push("finishLap");
      if (lap.status !== "sending") return;
      lap.status = "done";
      lap.finishedAt = new Date();
      audits.push({ action: "lap.finish", targetId: lapId, details });
    },
    async rankCampaignLaps(campaignId) {
      store.rankedCampaigns.push(campaignId);
    },
    async claimQueuedLaps() {
      if (lap.status !== "queued") return [];
      lap.status = "sending";
      return [{ id: lap.id, organisationId: lap.organisationId, campaignId: lap.campaignId }];
    },
    async unclaimLap() {
      if (lap.status === "sending") lap.status = "queued";
    },
    async listCampaignLaps() {
      return [
        {
          id: lap.id,
          status: lap.status,
          testSize: lap.testSize,
          sent: lap.sent,
          failed: lap.failed,
        },
      ];
    },
    async createQueuedLap(input) {
      return { ...input, id: nextId("lap"), status: "queued", sent: 0, failed: 0, costMicro: 0n };
    },
    async loadLapPlanningContext() {
      return {
        campaign: { ...options.ctx.campaign },
        list: { ...options.ctx.list },
        route: { id: options.ctx.route.id, provider: options.ctx.route.provider, active: true },
      };
    },
  };
  return store;
}
