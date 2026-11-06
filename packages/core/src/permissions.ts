/**
 * Role based permissions. Pure: no I/O, no Clerk types.
 *
 * Roles mirror the `member_role` enum in `packages/db`:
 * - `owner` can do everything, including money, members and the emergency stop.
 * - `campaign_manager` runs the day to day: lists, campaigns, sending and stopping.
 * - `viewer` is read only.
 */
export const ROLES = ["owner", "campaign_manager", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "campaign.create",
  "campaign.send",
  "campaign.stop",
  "campaign.view",
  "list.upload",
  "list.flush",
  "list.view",
  "settings.view",
  "settings.manage",
  "balance.deposit",
  "member.manage",
  "emergency.stop",
  "audit.view",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Actions that only an owner may perform. */
const OWNER_ONLY: ReadonlySet<Action> = new Set<Action>([
  "settings.manage",
  "balance.deposit",
  "member.manage",
  "emergency.stop",
  "audit.view",
]);

/** The read-only subset a viewer gets. `audit.view` is deliberately not here. */
const VIEWER_ALLOWED: ReadonlySet<Action> = new Set<Action>([
  "campaign.view",
  "list.view",
  "settings.view",
]);

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

/** Whether `role` may perform `action`. */
export function can(role: Role, action: Action): boolean {
  switch (role) {
    case "owner":
      return true;
    case "campaign_manager":
      return !OWNER_ONLY.has(action);
    case "viewer":
      return VIEWER_ALLOWED.has(action);
  }
}
