/** Tab names of the campaign page, shared by the server page (URL parsing) and the client tabs. */

export const CAMPAIGN_TAB_VALUES = ["status", "logs", "analytics", "single"] as const;
export type CampaignTab = (typeof CAMPAIGN_TAB_VALUES)[number];

export function isCampaignTab(value: string | null): value is CampaignTab {
  return (CAMPAIGN_TAB_VALUES as readonly string[]).includes(value ?? "");
}

export const LOGS_SUB_TAB_VALUES = ["messages", "actions", "adtexts", "offers", "sids"] as const;
export type LogsSubTab = (typeof LOGS_SUB_TAB_VALUES)[number];

export function isLogsSubTab(value: string | null): value is LogsSubTab {
  return (LOGS_SUB_TAB_VALUES as readonly string[]).includes(value ?? "");
}
