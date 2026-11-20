import { describe, expect, it } from "vitest";
import { autoStartAllowed, markTourSeen, stepsFor, tourKey, tourSeen } from "./steps";

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("stepsFor (D5-12)", () => {
  it("explains the Existing / New switch only to an organisation that has it", () => {
    expect(stepsFor({ hasSwitch: true }).map((s) => s.id)).toContain("switch");
    expect(stepsFor({ hasSwitch: false }).map((s) => s.id)).not.toContain("switch");
  });

  it("opens with a welcome, ends with how to replay, and gives every step its own id", () => {
    const steps = stepsFor({ hasSwitch: true });
    expect(steps[0]?.id).toBe("welcome");
    expect(steps.at(-1)?.id).toBe("done");
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it("walks the pages in menu order, then the lists", () => {
    const routes: string[] = [];
    for (const step of stepsFor({ hasSwitch: false })) {
      if (step.route && routes.at(-1) !== step.route) routes.push(step.route);
    }
    expect(routes).toEqual([
      "/kpi/insight",
      "/kpi/sales-results",
      "/kpi/trends",
      "/kpi/list-follow-up",
      "/kpi/daily-plan",
      "/lists",
    ]);
  });

  it("points every step at something on the page, apart from the welcome", () => {
    for (const step of stepsFor({ hasSwitch: true })) {
      if (step.id === "welcome") continue;
      expect(step.target, step.id).toBeTruthy();
      expect(step.title.length, step.id).toBeGreaterThan(0);
      expect(step.body.length, step.id).toBeGreaterThan(20);
    }
  });

  it("covers Create Campaign, the daily target and the data provider", () => {
    const ids = stepsFor({ hasSwitch: false }).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["create-campaign", "daily-plan", "data-provider"]));
  });
});

describe("tour memory", () => {
  it("is per organisation and remembers a finished tour", () => {
    const storage = memory();
    expect(tourKey("org-1")).toBe("sendex-tour-org-1");
    expect(tourSeen(storage, "org-1")).toBe(false);
    markTourSeen(storage, "org-1");
    expect(tourSeen(storage, "org-1")).toBe(true);
    expect(tourSeen(storage, "org-2")).toBe(false);
  });

  it("never throws when the browser blocks storage", () => {
    expect(tourSeen(broken, "org-1")).toBe(false);
    expect(() => markTourSeen(broken, "org-1")).not.toThrow();
    expect(autoStartAllowed(broken)).toBe(true);
    expect(tourSeen(null, "org-1")).toBe(false);
  });

  it("lets the browser tests switch the automatic start off", () => {
    const storage = memory();
    expect(autoStartAllowed(storage)).toBe(true);
    storage.setItem("sendex-tour-off", "1");
    expect(autoStartAllowed(storage)).toBe(false);
  });
});
