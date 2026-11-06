import { describe, expect, it } from "vitest";
import { ACTIONS, type Action, can, isAction, isRole, ROLES, type Role } from "./permissions.js";

const OWNER_ONLY: Action[] = [
  "settings.manage",
  "balance.deposit",
  "member.manage",
  "emergency.stop",
  "audit.view",
];

const VIEWER_ALLOWED: Action[] = ["campaign.view", "list.view", "settings.view"];

describe("can", () => {
  it("lists every role and action once", () => {
    expect(ROLES).toEqual(["owner", "campaign_manager", "viewer"]);
    expect(ACTIONS).toEqual([
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
    ]);
  });

  it("owner can do everything", () => {
    for (const action of ACTIONS) {
      expect(can("owner", action), action).toBe(true);
    }
  });

  it("campaign manager can do everything except the owner-only actions", () => {
    for (const action of ACTIONS) {
      expect(can("campaign_manager", action), action).toBe(!OWNER_ONLY.includes(action));
    }
  });

  it("viewer can only view campaigns, lists and settings, not the audit log", () => {
    for (const action of ACTIONS) {
      expect(can("viewer", action), action).toBe(VIEWER_ALLOWED.includes(action));
    }
    expect(can("viewer", "audit.view")).toBe(false);
  });

  it("matches the full role/action matrix", () => {
    const matrix: Record<Role, Record<Action, boolean>> = {
      owner: {
        "campaign.create": true,
        "campaign.send": true,
        "campaign.stop": true,
        "campaign.view": true,
        "list.upload": true,
        "list.flush": true,
        "list.view": true,
        "settings.view": true,
        "settings.manage": true,
        "balance.deposit": true,
        "member.manage": true,
        "emergency.stop": true,
        "audit.view": true,
      },
      campaign_manager: {
        "campaign.create": true,
        "campaign.send": true,
        "campaign.stop": true,
        "campaign.view": true,
        "list.upload": true,
        "list.flush": true,
        "list.view": true,
        "settings.view": true,
        "settings.manage": false,
        "balance.deposit": false,
        "member.manage": false,
        "emergency.stop": false,
        "audit.view": false,
      },
      viewer: {
        "campaign.create": false,
        "campaign.send": false,
        "campaign.stop": false,
        "campaign.view": true,
        "list.upload": false,
        "list.flush": false,
        "list.view": true,
        "settings.view": true,
        "settings.manage": false,
        "balance.deposit": false,
        "member.manage": false,
        "emergency.stop": false,
        "audit.view": false,
      },
    };
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        expect(can(role, action), `${role} ${action}`).toBe(matrix[role][action]);
      }
    }
  });
});

describe("type guards", () => {
  it("isRole accepts only known roles", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("org:admin")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("isAction accepts only known actions", () => {
    expect(isAction("campaign.send")).toBe(true);
    expect(isAction("campaign.delete")).toBe(false);
    expect(isAction(42)).toBe(false);
  });
});
