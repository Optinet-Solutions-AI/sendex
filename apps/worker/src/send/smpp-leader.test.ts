import {
  createProviderRegistry,
  FakeProvider,
  SmppProvider,
  type SmppSimulator,
  startSimulator,
} from "@sendex/providers";
import { createFakeRedis } from "@sendex/redis-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { LogFields, LogLevel } from "../log.js";
import { bindSmppAsLeader, type SendWorkerLike, smppLeaderKey } from "./smpp-leader.js";

type Line = { level: LogLevel; msg: string; fields?: LogFields };

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function collect(): { lines: Line[]; log: (l: LogLevel, m: string, f?: LogFields) => void } {
  const lines: Line[] = [];
  return {
    lines,
    log: (level, msg, fields) => {
      lines.push(fields === undefined ? { level, msg } : { level, msg, fields });
    },
  };
}

function fakeSendWorker(): SendWorkerLike & { state: "running" | "paused" } {
  return {
    state: "running",
    async pause() {
      this.state = "paused";
    },
    resume() {
      this.state = "running";
    },
  };
}

function smppFor(sim: SmppSimulator): SmppProvider {
  return new SmppProvider({
    name: "23telecom",
    host: "127.0.0.1",
    port: sim.port,
    systemId: "test",
    password: "test",
    prices: {},
    session: { connectTimeoutMs: 2_000, bindTimeoutMs: 5_000, submitTimeoutMs: 5_000 },
  });
}

describe("bindSmppAsLeader", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  it("does nothing without an SMPP provider", async () => {
    const { log } = collect();
    const sendWorker = fakeSendWorker();
    const leadership = bindSmppAsLeader({
      registry: createProviderRegistry().register("fake", new FakeProvider()),
      redis: createFakeRedis(),
      holderId: "m1",
      log,
      sendWorker,
    });
    expect(leadership.providers).toEqual([]);
    expect(sendWorker.state).toBe("running");
    await leadership.close();
  });

  it("binds only on the machine that holds the lock and hands over when it releases", async () => {
    const sim = await startSimulator();
    cleanup.push(() => sim.close());
    const redis = createFakeRedis();
    const a = smppFor(sim);
    const b = smppFor(sim);
    const logA = collect();
    const logB = collect();
    const sendA = fakeSendWorker();
    const sendB = fakeSendWorker();

    const leaderA = bindSmppAsLeader({
      registry: createProviderRegistry().register("23telecom", a),
      redis,
      holderId: "machine-a",
      log: logA.log,
      sendWorker: sendA,
      retryMs: 50,
      ttlMs: 2_000,
      renewEveryMs: 500,
    });
    cleanup.push(() => leaderA.close());
    await waitFor(() => leaderA.isLeader("23telecom"));
    await waitFor(() => sim.stats.binds === 1);
    expect(await redis.get(smppLeaderKey("23telecom"))).toBe("machine-a");
    await waitFor(() => sendA.state === "running");

    const leaderB = bindSmppAsLeader({
      registry: createProviderRegistry().register("23telecom", b),
      redis,
      holderId: "machine-b",
      log: logB.log,
      sendWorker: sendB,
      retryMs: 50,
      ttlMs: 2_000,
      renewEveryMs: 500,
    });
    cleanup.push(() => leaderB.close());
    // B keeps retrying, never binds, and keeps its send worker paused.
    await new Promise((r) => setTimeout(r, 200));
    expect(leaderB.isLeader("23telecom")).toBe(false);
    expect(sim.stats.binds).toBe(1);
    expect(sendB.state).toBe("paused");

    // A goes away (deploy, SIGTERM): the key is released, B wins within one retry interval.
    await leaderA.close();
    await waitFor(() => leaderB.isLeader("23telecom"));
    await waitFor(() => sim.stats.binds === 2);
    expect(await redis.get(smppLeaderKey("23telecom"))).toBe("machine-b");
    await waitFor(() => sendB.state === "running");
    expect(logA.lines.map((l) => l.msg)).toContain("smpp leadership acquired");
    expect(logB.lines.map((l) => l.msg)).toContain("smpp leadership acquired");
    expect(JSON.stringify([...logA.lines, ...logB.lines])).not.toContain("password");
  });

  it("closes the bind, pauses sending and reports when the lock is lost", async () => {
    const sim = await startSimulator();
    cleanup.push(() => sim.close());
    const redis = createFakeRedis();
    const provider = smppFor(sim);
    const { lines, log } = collect();
    const sendWorker = fakeSendWorker();
    const lost: string[] = [];

    const leadership = bindSmppAsLeader({
      registry: createProviderRegistry().register("23telecom", provider),
      redis,
      holderId: "machine-a",
      log,
      sendWorker,
      onLost: (name) => lost.push(name),
      retryMs: 50,
      ttlMs: 300,
      renewEveryMs: 50,
    });
    cleanup.push(() => leadership.close());
    await waitFor(() => leadership.isLeader("23telecom") && sim.stats.binds === 1);

    // Another holder steals the key (an expired TTL after a Redis hiccup looks the same).
    await redis.set(smppLeaderKey("23telecom"), "machine-z");
    await waitFor(() => lost.length === 1);
    expect(leadership.isLeader("23telecom")).toBe(false);
    expect(sendWorker.state).toBe("paused");
    expect(provider.session.state).toBe("closed");
    expect(lines.some((l) => l.level === "warn" && l.msg === "smpp leadership lost")).toBe(true);
  });
});
