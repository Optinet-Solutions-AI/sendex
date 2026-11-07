import type { AutosenderLap } from "@sendex/core";
import type { AutosenderCampaign, AutosenderStore, ScaleOutInput } from "@sendex/db";
import { describe, expect, it } from "vitest";
import { runAutosenderTick } from "./autosender.js";

const T0 = new Date("2026-11-07T09:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const campaign: AutosenderCampaign = {
  id: "c1",
  organisationId: "org",
  testSize: 100,
  contactReuse: "account_wide",
  measureMinutes: 60,
  scaleFactor: 5,
  ctrFloorPercent: 80,
};

function fakeStore(options: {
  campaigns?: AutosenderCampaign[];
  laps: AutosenderLap[];
  available: Array<{ listId: string; available: number }>;
}) {
  const scaled: ScaleOutInput[] = [];
  const stopped: Array<{ campaignId: string; reason: string }> = [];
  const store: AutosenderStore = {
    async listAutosenderCampaigns() {
      return options.campaigns ?? [campaign];
    },
    async listLaps() {
      return options.laps;
    },
    async availableByList() {
      return options.available;
    },
    async createScaleLaps(input) {
      scaled.push(input);
      return input.laps.map((_, i) => `lap-${i}`);
    },
    async stop(input) {
      stopped.push({ campaignId: input.campaignId, reason: input.reason });
    },
  };
  return { store, scaled, stopped };
}

const logs: Array<{ level: string; msg: string }> = [];
const log = (level: string, msg: string) => {
  logs.push({ level, msg });
};

const testLap: AutosenderLap = {
  id: "t1",
  routeId: "R405",
  listId: "L1",
  status: "done",
  scale: false,
  sent: 100,
  clicks: 5,
  costMicro: 2_500_000,
  startedAt: T0,
  finishedAt: at(5),
};

describe("runAutosenderTick", () => {
  it("queues scale-out laps on the winning route once the test round is measured", async () => {
    const f = fakeStore({ laps: [testLap], available: [{ listId: "L1", available: 2_000 }] });
    const result = await runAutosenderTick({ store: f.store, log, now: () => at(60) });
    expect(result).toEqual({ campaigns: 1, scaled: 1, stopped: 0, waiting: 0, failed: 0 });
    expect(f.scaled).toEqual([
      { campaign, routeId: "R405", laps: [{ listId: "L1", count: 500 }], testCtr: 0.05 },
    ]);
  });

  it("waits during the measure window and stops when the lists are finished", async () => {
    const waiting = fakeStore({ laps: [testLap], available: [{ listId: "L1", available: 10 }] });
    expect(await runAutosenderTick({ store: waiting.store, log, now: () => at(10) })).toMatchObject(
      {
        waiting: 1,
      },
    );
    const done = fakeStore({ laps: [testLap], available: [{ listId: "L1", available: 0 }] });
    expect(await runAutosenderTick({ store: done.store, log, now: () => at(60) })).toMatchObject({
      stopped: 1,
    });
    expect(done.stopped).toEqual([{ campaignId: "c1", reason: "lists finished" }]);
  });

  it("a failing campaign is logged and counted, the others still run", async () => {
    const f = fakeStore({
      campaigns: [campaign, { ...campaign, id: "c2" }],
      laps: [testLap],
      available: [{ listId: "L1", available: 10 }],
    });
    const listLaps = f.store.listLaps;
    f.store.listLaps = async (id) => {
      if (id === "c1") throw new Error("boom");
      return listLaps(id);
    };
    const result = await runAutosenderTick({ store: f.store, log, now: () => at(60) });
    expect(result).toMatchObject({ campaigns: 2, scaled: 1, failed: 1 });
    expect(logs.some((l) => l.level === "error")).toBe(true);
  });
});
