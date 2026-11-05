import {
  createProviderRegistry,
  FakeProvider,
  type OutboundMessage,
  SmppProvider,
  type SmppSimulator,
  startSimulator,
} from "@sendex/providers";
import { afterEach, describe, expect, it } from "vitest";
import type { DlrJob } from "../jobs.js";
import type { LogFields, LogLevel } from "../log.js";
import { smppReceiptRaw, subscribeDeliveryReceipts } from "./subscribe.js";

type Line = { level: LogLevel; msg: string; fields?: LogFields };

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("smppReceiptRaw", () => {
  it("keeps the receipt text and TLVs, drops addresses and turns buffers into text", () => {
    const raw = smppReceiptRaw({
      source_addr: "34600000001",
      destination_addr: "BIGSPINS",
      short_message: { message: Buffer.from("id:sim-1 sub:001 dlvrd:001 stat:DELIVRD err:000") },
      receipted_message_id: "sim-1",
      message_state: 2,
    });
    expect(raw).toEqual({
      short_message: "id:sim-1 sub:001 dlvrd:001 stat:DELIVRD err:000",
      receipted_message_id: "sim-1",
      message_state: 2,
    });
    expect(JSON.stringify(raw)).not.toContain("34600000001");
  });
});

describe("subscribeDeliveryReceipts", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  it("enqueues one dlr job per receipt of every SMPP provider, under its registry name", async () => {
    const sim: SmppSimulator = await startSimulator();
    cleanup.push(() => sim.close());
    const smpp = new SmppProvider({
      name: "23telecom",
      host: "127.0.0.1",
      port: sim.port,
      systemId: "test",
      password: "test",
      prices: {},
      session: { connectTimeoutMs: 2_000, bindTimeoutMs: 5_000, submitTimeoutMs: 5_000 },
    });
    cleanup.push(() => smpp.close());
    const registry = createProviderRegistry()
      .register("fake", new FakeProvider())
      .register("smpp", smpp);
    const jobs: DlrJob[] = [];
    const lines: Line[] = [];
    const subscription = subscribeDeliveryReceipts({
      registry,
      enqueue: async (job) => {
        jobs.push(job);
      },
      log: (level, msg, fields) => {
        lines.push(fields === undefined ? { level, msg } : { level, msg, fields });
      },
    });
    expect(subscription.providers).toEqual(["smpp"]);

    const message: OutboundMessage = {
      id: "m1",
      to: "+34600000001",
      senderId: "BIGSPINS",
      text: "hello",
      encoding: "GSM_7BIT",
      route: "sim",
      country: "ES",
    };
    const [outcome] = await smpp.send([message]);
    expect(outcome).toMatchObject({ status: "accepted", providerMessageId: "sim-1" });
    await waitFor(() => jobs.length === 1);

    const [job] = jobs;
    expect(job?.provider).toBe("smpp");
    // The payload round-trips through JSON and parses back to the same receipt.
    const replayed = JSON.parse(JSON.stringify(job?.raw)) as unknown;
    expect(smpp.parseDeliveryReceipt(replayed)).toMatchObject({
      providerMessageId: "sim-1",
      status: "delivered",
      errorCode: "000",
    });
    expect(JSON.stringify(job)).not.toContain("34600000001");

    subscription.unsubscribe();
    await smpp.send([{ ...message, id: "m2" }]);
    await new Promise((r) => setTimeout(r, 100));
    expect(jobs).toHaveLength(1);
    expect(lines).toEqual([]);
  });
});
