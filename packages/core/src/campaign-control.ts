/**
 * Pause, resume, stop and (re)schedule a campaign (D2-08, D2-09): the state machine and the
 * Zod schemas of the actions. Pure, so the rules are tested here and shared by the web
 * actions, the database helpers and the worker's internal API.
 */
import { z } from "zod";

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "paused",
  "stopped",
  "completed",
] as const;
export type CampaignControlStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_CONTROL_ACTIONS = [
  "pause",
  "resume",
  "stop",
  "reschedule",
  "cancel_schedule",
] as const;
export type CampaignControlAction = (typeof CAMPAIGN_CONTROL_ACTIONS)[number];

export interface TransitionContext {
  /** Whether `campaigns.scheduled_at` is still ahead of now; decides where a resume lands. */
  scheduledInFuture?: boolean;
}

export class CampaignTransitionError extends Error {
  readonly status: CampaignControlStatus;
  readonly action: CampaignControlAction;

  constructor(status: CampaignControlStatus, action: CampaignControlAction) {
    super(`Cannot ${action.replace("_", " ")} a campaign that is "${status}"`);
    this.name = "CampaignTransitionError";
    this.status = status;
    this.action = action;
  }
}

/** Which statuses each action may start from. */
const ALLOWED: Readonly<Record<CampaignControlAction, readonly CampaignControlStatus[]>> = {
  pause: ["sending", "scheduled"],
  resume: ["paused"],
  stop: ["sending", "scheduled", "paused"],
  reschedule: ["draft", "scheduled"],
  cancel_schedule: ["draft", "scheduled"],
};

export function canTransition(
  status: CampaignControlStatus,
  action: CampaignControlAction,
): boolean {
  return ALLOWED[action].includes(status);
}

/**
 * The status a campaign moves to when `action` is applied, or a `CampaignTransitionError`.
 *
 * - pause: sending | scheduled -> paused (the dispatcher claims no lap, running laps park)
 * - resume: paused -> sending, or scheduled when the start time is still ahead
 * - stop: sending | scheduled | paused -> stopped (terminal)
 * - reschedule: draft | scheduled keep their status; only the time changes
 * - cancel_schedule: scheduled -> draft (its queued laps are cancelled); draft stays draft
 */
export function campaignTransition(
  status: CampaignControlStatus,
  action: CampaignControlAction,
  context: TransitionContext = {},
): CampaignControlStatus {
  if (!canTransition(status, action)) throw new CampaignTransitionError(status, action);
  switch (action) {
    case "pause":
      return "paused";
    case "resume":
      return context.scheduledInFuture ? "scheduled" : "sending";
    case "stop":
      return "stopped";
    case "reschedule":
      return status;
    case "cancel_schedule":
      return "draft";
  }
}

// ---------------------------------------------------------------------------
// Local time
// ---------------------------------------------------------------------------

export interface LocalDayAndTime {
  /** `YYYY-MM-DD` */
  day: string;
  /** `HH:mm` (24 h) */
  time: string;
}

/** The wall-clock day and time of `instant` in an IANA zone; what the scheduled view groups by. */
export function localDayAndTime(instant: Date, timezone: string): LocalDayAndTime {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

// ---------------------------------------------------------------------------
// Schemas (server actions, internal API)
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();

/** Pause, resume or stop one campaign. */
export const campaignControlSchema = z.object({
  campaignId: uuid,
  action: z.enum(["pause", "resume", "stop"]),
});
export type CampaignControlInput = z.infer<typeof campaignControlSchema>;

/** Move a scheduled (or draft) campaign's start to another instant, given in UTC. */
export const rescheduleCampaignSchema = z.object({
  campaignId: uuid,
  scheduledAt: z.iso
    .datetime({ offset: true })
    .refine((value) => new Date(value).getTime() > Date.now(), {
      message: "The start time must be in the future",
    }),
});
export type RescheduleCampaignInput = z.infer<typeof rescheduleCampaignSchema>;

export const cancelScheduleSchema = z.object({ campaignId: uuid });
export type CancelScheduleInput = z.infer<typeof cancelScheduleSchema>;

/** `POST /internal/emergency-stop`: raise the organisation's stop flag. */
export const emergencyStopRequestSchema = z.object({
  organisationId: z.string().min(1),
  reason: z.string().trim().min(1, "Give a reason").max(200),
  byUserId: z.string().min(1),
});
export type EmergencyStopRequest = z.infer<typeof emergencyStopRequestSchema>;

/** `DELETE /internal/emergency-stop` and `GET` query: which organisation. */
export const emergencyStopOrganisationSchema = z.object({ organisationId: z.string().min(1) });

export const emergencyStopRecordSchema = z.object({
  reason: z.string(),
  byUserId: z.string(),
  stoppedAt: z.string(),
});
export type EmergencyStopRecord = z.infer<typeof emergencyStopRecordSchema>;

/** What the internal API answers for an organisation's flag. */
export const emergencyStopStateSchema = z.discriminatedUnion("stopped", [
  z.object({ stopped: z.literal(false), stop: z.null() }),
  z.object({ stopped: z.literal(true), stop: emergencyStopRecordSchema }),
]);
export type EmergencyStopState = z.infer<typeof emergencyStopStateSchema>;
