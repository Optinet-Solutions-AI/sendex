import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_CONTROL_ACTIONS,
  type CampaignControlAction,
  CampaignTransitionError,
  campaignControlSchema,
  campaignTransition,
  cancelScheduleSchema,
  canTransition,
  emergencyStopRequestSchema,
  emergencyStopStateSchema,
  localDayAndTime,
  rescheduleCampaignSchema,
} from "./campaign-control.js";

const ID = "7b1c3e2a-5d4f-4c6b-8a9e-0f1d2c3b4a59";

describe("campaignTransition", () => {
  it("pauses a sending or scheduled campaign", () => {
    expect(campaignTransition("sending", "pause")).toBe("paused");
    expect(campaignTransition("scheduled", "pause")).toBe("paused");
  });

  it("resumes to sending, or back to scheduled when the start time is still ahead", () => {
    expect(campaignTransition("paused", "resume")).toBe("sending");
    expect(campaignTransition("paused", "resume", { scheduledInFuture: true })).toBe("scheduled");
  });

  it("stops a sending, scheduled or paused campaign", () => {
    expect(campaignTransition("sending", "stop")).toBe("stopped");
    expect(campaignTransition("scheduled", "stop")).toBe("stopped");
    expect(campaignTransition("paused", "stop")).toBe("stopped");
  });

  it("reschedules a draft or scheduled campaign without changing its status", () => {
    expect(campaignTransition("draft", "reschedule")).toBe("draft");
    expect(campaignTransition("scheduled", "reschedule")).toBe("scheduled");
  });

  it("cancelling a schedule returns the campaign to draft", () => {
    expect(campaignTransition("scheduled", "cancel_schedule")).toBe("draft");
    expect(campaignTransition("draft", "cancel_schedule")).toBe("draft");
  });

  it("refuses every other move with a readable error", () => {
    const refused: Array<[Parameters<typeof campaignTransition>[0], CampaignControlAction]> = [
      ["draft", "pause"],
      ["draft", "resume"],
      ["draft", "stop"],
      ["sending", "resume"],
      ["sending", "reschedule"],
      ["sending", "cancel_schedule"],
      ["paused", "pause"],
      ["paused", "reschedule"],
      ["stopped", "pause"],
      ["stopped", "resume"],
      ["stopped", "stop"],
      ["completed", "pause"],
      ["completed", "stop"],
    ];
    for (const [status, action] of refused) {
      expect(() => campaignTransition(status, action)).toThrow(CampaignTransitionError);
      expect(canTransition(status, action)).toBe(false);
    }
    expect(() => campaignTransition("stopped", "resume")).toThrow(
      'Cannot resume a campaign that is "stopped"',
    );
    expect(canTransition("sending", "pause")).toBe(true);
  });

  it("lists the actions in the order the UI shows them", () => {
    expect(CAMPAIGN_CONTROL_ACTIONS).toEqual([
      "pause",
      "resume",
      "stop",
      "reschedule",
      "cancel_schedule",
    ]);
  });
});

describe("localDayAndTime", () => {
  it("gives the wall-clock day and time of an instant in the campaign zone", () => {
    const instant = new Date("2099-01-10T23:30:00Z");
    expect(localDayAndTime(instant, "Europe/Madrid")).toEqual({ day: "2099-01-11", time: "00:30" });
    expect(localDayAndTime(instant, "Europe/London")).toEqual({ day: "2099-01-10", time: "23:30" });
    expect(localDayAndTime(instant, "Pacific/Auckland")).toEqual({
      day: "2099-01-11",
      time: "12:30",
    });
    expect(localDayAndTime(new Date("2099-07-01T12:00:00Z"), "UTC")).toEqual({
      day: "2099-07-01",
      time: "12:00",
    });
  });
});

describe("schemas", () => {
  it("campaignControlSchema takes a campaign id and one of pause / resume / stop", () => {
    expect(campaignControlSchema.parse({ campaignId: ID, action: "pause" })).toEqual({
      campaignId: ID,
      action: "pause",
    });
    expect(campaignControlSchema.safeParse({ campaignId: ID, action: "reschedule" }).success).toBe(
      false,
    );
    expect(campaignControlSchema.safeParse({ campaignId: "nope", action: "stop" }).success).toBe(
      false,
    );
  });

  it("rescheduleCampaignSchema wants an ISO instant in the future", () => {
    const parsed = rescheduleCampaignSchema.parse({
      campaignId: ID,
      scheduledAt: "2099-06-01T08:00:00.000Z",
    });
    expect(parsed.scheduledAt).toBe("2099-06-01T08:00:00.000Z");
    expect(
      rescheduleCampaignSchema.safeParse({ campaignId: ID, scheduledAt: "2001-01-01T00:00:00Z" })
        .success,
    ).toBe(false);
    expect(
      rescheduleCampaignSchema.safeParse({ campaignId: ID, scheduledAt: "tomorrow" }).success,
    ).toBe(false);
    expect(cancelScheduleSchema.parse({ campaignId: ID })).toEqual({ campaignId: ID });
  });

  it("emergency stop request needs an organisation, a reason and the user", () => {
    expect(
      emergencyStopRequestSchema.parse({ organisationId: ID, reason: " bad link ", byUserId: ID }),
    ).toEqual({ organisationId: ID, reason: "bad link", byUserId: ID });
    expect(
      emergencyStopRequestSchema.safeParse({ organisationId: ID, reason: "  ", byUserId: ID })
        .success,
    ).toBe(false);
    expect(
      emergencyStopRequestSchema.safeParse({
        organisationId: ID,
        reason: "x".repeat(201),
        byUserId: ID,
      }).success,
    ).toBe(false);
  });

  it("emergency stop state is either stopped with the record or not stopped", () => {
    expect(emergencyStopStateSchema.parse({ stopped: false, stop: null })).toEqual({
      stopped: false,
      stop: null,
    });
    const stop = { reason: "bad link", byUserId: ID, stoppedAt: "2026-11-06T10:00:00.000Z" };
    expect(emergencyStopStateSchema.parse({ stopped: true, stop })).toEqual({
      stopped: true,
      stop,
    });
    expect(emergencyStopStateSchema.safeParse({ stopped: true, stop: null }).success).toBe(false);
  });
});
