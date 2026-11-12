import type { CampaignStatus } from "./types";

export type CampaignStatusVariant =
  | "secondary"
  | "outline"
  | "active"
  | "warning"
  | "destructive"
  | "success";

const LABELS: Record<CampaignStatus, { label: string; variant: CampaignStatusVariant }> = {
  draft: { label: "Draft", variant: "secondary" },
  scheduled: { label: "Scheduled", variant: "outline" },
  sending: { label: "Sending", variant: "active" },
  paused: { label: "Paused", variant: "warning" },
  stopped: { label: "Stopped", variant: "destructive" },
  completed: { label: "Completed", variant: "success" },
};

/**
 * The label and badge colour of a campaign status. Each status has its own label (decisions
 * item 35, 2026-11-12): the team wants drafts and stopped campaigns told apart, which the
 * earlier Active / Paused / Done grouping hid.
 */
export function campaignStatusLabel(status: CampaignStatus): {
  label: string;
  variant: CampaignStatusVariant;
} {
  return LABELS[status];
}
