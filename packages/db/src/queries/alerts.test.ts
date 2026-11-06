import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, users } from "../schema/core.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { acknowledgeAlert, listOpenAlerts, raiseAlert } from "./alerts.js";

let t: TestDb;
let orgA: string;
let orgB: string;
let userId: string;

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");
  const [user] = await t.db
    .insert(users)
    .values({ clerkUserId: "user_1", email: "owner@example.com", name: "Owner" })
    .returning({ id: users.id });
  if (!user) throw new Error("user insert returned no row");
  userId = user.id;
});

afterAll(async () => {
  await t.close();
});

describe("alerts", () => {
  it("raises an alert once per organisation, kind and period, with an audit row", async () => {
    const first = await raiseAlert(t.db, orgA, {
      kind: "daily_message_cap",
      periodKey: "2026-11-06",
      message: "Daily message cap of 500 reached; 100 messages refused.",
      details: { cap: 500, refused: 100, lapId: "lap-1" },
    });
    expect(first.created).toBe(true);
    expect(first.alert).toMatchObject({
      organisationId: orgA,
      kind: "daily_message_cap",
      periodKey: "2026-11-06",
      acknowledgedAt: null,
      details: { cap: 500, refused: 100, lapId: "lap-1" },
    });

    const again = await raiseAlert(t.db, orgA, {
      kind: "daily_message_cap",
      periodKey: "2026-11-06",
      message: "a different message is ignored",
    });
    expect(again.created).toBe(false);
    expect(again.alert.id).toBe(first.alert.id);
    expect(again.alert.message).toBe(first.alert.message);

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.organisationId, orgA));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "alert.raise",
      targetType: "alert",
      targetId: first.alert.id,
      details: { kind: "daily_message_cap", periodKey: "2026-11-06", cap: 500, refused: 100 },
    });
  });

  it("is scoped per organisation and per period", async () => {
    const other = await raiseAlert(t.db, orgB, {
      kind: "daily_message_cap",
      periodKey: "2026-11-06",
      message: "org B hit its cap",
    });
    expect(other.created).toBe(true);
    const nextDay = await raiseAlert(t.db, orgA, {
      kind: "daily_message_cap",
      periodKey: "2026-11-07",
      message: "the next day",
    });
    expect(nextDay.created).toBe(true);
  });

  it("rejects an unknown kind at the boundary", async () => {
    await expect(
      raiseAlert(t.db, orgA, { kind: "whatever" as never, periodKey: "x", message: "m" }),
    ).rejects.toThrow();
  });

  it("lists open alerts newest first and only for the organisation", async () => {
    const open = await listOpenAlerts(t.db, orgA);
    expect(open.map((a) => a.periodKey)).toEqual(["2026-11-07", "2026-11-06"]);
    expect(open.every((a) => a.organisationId === orgA)).toBe(true);
  });

  it("acknowledges an alert once, for the right organisation, and audits it", async () => {
    const [target] = await listOpenAlerts(t.db, orgA);
    if (!target) throw new Error("no open alert");

    expect(await acknowledgeAlert(t.db, orgB, { alertId: target.id, userId })).toBeNull();

    const done = await acknowledgeAlert(t.db, orgA, { alertId: target.id, userId });
    expect(done).toMatchObject({ id: target.id, acknowledgedBy: userId });
    expect(done?.acknowledgedAt).toBeInstanceOf(Date);
    expect(await acknowledgeAlert(t.db, orgA, { alertId: target.id, userId })).toBeNull();

    expect((await listOpenAlerts(t.db, orgA)).map((a) => a.periodKey)).toEqual(["2026-11-06"]);
    const audits = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "alert.acknowledge"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organisationId: orgA,
      actorUserId: userId,
      targetId: target.id,
      details: { kind: "daily_message_cap", periodKey: "2026-11-07" },
    });
  });
});
