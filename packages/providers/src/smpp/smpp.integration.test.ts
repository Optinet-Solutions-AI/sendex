/**
 * SmppProvider against the in-process simulator (D2-17). No Docker, no network beyond loopback.
 */

import type smpp from "smpp";
import { afterEach, describe, expect, it } from "vitest";
import type { DeliveryReceipt, OutboundMessage } from "../provider.js";
import { DATA_CODING_GSM7, DATA_CODING_UCS2, ESM_CLASS_UDHI } from "./encoding.js";
import { SmppBindError, SmppSessionClosedError } from "./session.js";
import { type SimulatorBehaviour, type SmppSimulator, startSimulator } from "./simulator.js";
import { SmppProvider, type SmppProviderOptions, type SmppSessionTuning } from "./smpp-provider.js";

const msg = (
  id: string,
  to = "+34600000001",
  text = "hello from sendex",
  encoding: OutboundMessage["encoding"] = "GSM_7BIT",
): OutboundMessage => ({
  id,
  to,
  senderId: "BIGSPINS",
  text,
  encoding,
  route: "sim",
  country: "ES",
});

const FAST_SESSION: SmppSessionTuning = {
  reconnectMinMs: 100,
  reconnectMaxMs: 400,
  connectTimeoutMs: 2_000,
  bindTimeoutMs: 5_000,
  submitTimeoutMs: 5_000,
};

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function udhBytes(pdu: smpp.PDU): number[] {
  const sm = pdu.short_message as smpp.DecodedMessage;
  const first = sm.udh?.[0];
  if (first === undefined) throw new Error("expected a UDH");
  return [...first];
}

function textOf(pdu: smpp.PDU): string {
  const sm = pdu.short_message;
  if (typeof sm === "string") return sm;
  const inner = (sm as smpp.DecodedMessage).message;
  return typeof inner === "string" ? inner : inner.toString("latin1");
}

describe("SmppProvider against the simulator", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  async function setUp(
    behaviour: SimulatorBehaviour = {},
    extra: Partial<SmppProviderOptions> = {},
  ): Promise<{ sim: SmppSimulator; provider: SmppProvider }> {
    const sim = await startSimulator({ behaviour });
    cleanup.push(() => sim.close());
    const provider = new SmppProvider({
      name: "sim",
      host: "127.0.0.1",
      port: sim.port,
      systemId: "test",
      password: "test",
      prices: { "sim:ES": 0.01 },
      session: FAST_SESSION,
      ...extra,
    });
    cleanup.push(() => provider.close());
    return { sim, provider };
  }

  it("binds and sends 50 messages, all accepted with provider ids", async () => {
    const { sim, provider } = await setUp();
    const batch = Array.from({ length: 50 }, (_, i) =>
      msg(`m${i}`, `+3460000${(1000 + i).toString()}`),
    );
    const outcomes = await provider.send(batch);
    expect(outcomes).toHaveLength(50);
    const accepted = outcomes.filter((o) => o.status === "accepted");
    expect(accepted).toHaveLength(50);
    const ids = new Set(accepted.map((o) => (o.status === "accepted" ? o.providerMessageId : "")));
    expect(ids.size).toBe(50);
    expect(sim.received.filter((p) => p.command === "submit_sm")).toHaveLength(50);
    expect(sim.received.filter((p) => p.command === "bind_transceiver")).toHaveLength(1);
    expect(outcomes.map((o) => o.id)).toEqual(batch.map((m) => m.id));
  });

  it("sends a two-part GSM text as two UDH PDUs sharing one reference", async () => {
    const { sim, provider } = await setUp();
    const text = `${"Big spins tonight. ".repeat(10)}Reply STOP to opt out`;
    expect(text.length).toBeGreaterThan(160);
    const [outcome] = await provider.send([msg("long", "+34600000002", text)]);
    expect(outcome?.status).toBe("accepted");

    const pdus = sim.received.filter((p) => p.command === "submit_sm");
    expect(pdus).toHaveLength(2);
    const refs = new Set<number>();
    pdus.forEach((pdu, i) => {
      expect(Number(pdu.esm_class) & ESM_CLASS_UDHI).toBe(ESM_CLASS_UDHI);
      expect(pdu.data_coding).toBe(DATA_CODING_GSM7);
      expect(pdu.registered_delivery).toBe(1);
      expect(pdu.source_addr_ton).toBe(5);
      expect(pdu.dest_addr_ton).toBe(1);
      expect(pdu.destination_addr).toBe("34600000002");
      const udh = udhBytes(pdu);
      expect(udh.slice(0, 2)).toEqual([0x00, 0x03]);
      expect(udh[3]).toBe(2);
      expect(udh[4]).toBe(i + 1);
      refs.add(udh[2] ?? -1);
    });
    expect(refs.size).toBe(1);
    expect(pdus.map(textOf).join("")).toBe(text);
    if (outcome?.status === "accepted") {
      expect(provider.partIds.get("long")).toEqual([outcome.providerMessageId, "sim-2"]);
    }
  });

  it("sends UCS-2 text with data_coding 8", async () => {
    const { sim, provider } = await setUp();
    const text = "Привет, мир ✓";
    const [outcome] = await provider.send([msg("ucs2", "+34600000003", text, "UCS2")]);
    expect(outcome?.status).toBe("accepted");
    const [pdu] = sim.received.filter((p) => p.command === "submit_sm");
    expect(pdu?.data_coding).toBe(DATA_CODING_UCS2);
    expect(pdu === undefined ? "" : textOf(pdu)).toBe(text);
  });

  it("maps throttling to failed and retryable", async () => {
    const { provider } = await setUp({ throttleEvery: 2 });
    const outcomes = await provider.send([msg("a"), msg("b"), msg("c"), msg("d")]);
    const failed = outcomes.filter((o) => o.status === "failed");
    expect(failed).toHaveLength(2);
    for (const o of failed) {
      expect(o).toMatchObject({ status: "failed", reason: "ESME_RTHROTTLED", retryable: true });
    }
    expect(outcomes.filter((o) => o.status === "accepted")).toHaveLength(2);
  });

  it("maps an invalid destination to failed and not retryable", async () => {
    const { provider } = await setUp();
    const outcomes = await provider.send([msg("bad", "+34600000099"), msg("ok", "+34600000001")]);
    expect(outcomes[0]).toEqual({
      id: "bad",
      status: "failed",
      reason: "ESME_RINVDSTADR",
      retryable: false,
    });
    expect(outcomes[1]?.status).toBe("accepted");
  });

  it("receives and parses delivery receipts with the right provider id", async () => {
    const { sim, provider } = await setUp({ receiptDelayMs: 10 });
    const receipts: DeliveryReceipt[] = [];
    provider.onDeliveryReceipt((r) => receipts.push(r));

    const [ok, undeliverable] = await provider.send([
      msg("ok", "+34600000001"),
      msg("ko", "+34600000098"),
    ]);
    if (ok?.status !== "accepted" || undeliverable?.status !== "accepted") {
      throw new Error("expected both accepted");
    }
    await waitFor(() => receipts.length === 2);

    const delivered = receipts.find((r) => r.providerMessageId === ok.providerMessageId);
    expect(delivered).toMatchObject({ status: "delivered", errorCode: "000" });
    expect(delivered?.at).toBeInstanceOf(Date);
    const failed = receipts.find((r) => r.providerMessageId === undeliverable.providerMessageId);
    expect(failed).toMatchObject({ status: "failed", errorCode: "001" });

    await waitFor(() => sim.stats.receiptAcks === 2);
  });

  it("reconnects after the SMSC goes away and the next send succeeds", async () => {
    const { sim, provider } = await setUp({ sendReceipts: false });
    const [first] = await provider.send([msg("before")]);
    expect(first?.status).toBe("accepted");
    const port = sim.port;

    const dropped = new Promise<void>((resolve) =>
      provider.session.once("disconnected", () => resolve()),
    );
    await sim.close();
    await dropped;
    expect(provider.session.state).not.toBe("bound");

    const again = await startSimulator({ port, behaviour: { sendReceipts: false } });
    cleanup.push(() => again.close());
    const [second] = await provider.send([msg("after")]);
    expect(second?.status).toBe("accepted");
    expect(provider.session.binds).toBe(2);
    expect(again.received.filter((p) => p.command === "submit_sm")).toHaveLength(1);
  });

  it("throws when the SMSC refuses the bind", async () => {
    const { provider } = await setUp({ bindStatus: 0x0e }, { session: { ...FAST_SESSION } });
    await expect(provider.send([msg("x")])).rejects.toBeInstanceOf(SmppBindError);
    expect(provider.session.binds).toBe(0);
  });

  it("keeps at most windowSize submit_sm in flight", async () => {
    const { sim, provider } = await setUp(
      { responseDelayMs: 30, sendReceipts: false },
      { windowSize: 3 },
    );
    const outcomes = await provider.send(Array.from({ length: 12 }, (_, i) => msg(`w${i}`)));
    expect(outcomes.every((o) => o.status === "accepted")).toBe(true);
    expect(sim.stats.maxInFlight).toBeLessThanOrEqual(3);
    expect(sim.stats.maxInFlight).toBeGreaterThanOrEqual(2);
  });

  it("caps throughput when throughputPerSecond is set", async () => {
    const { provider } = await setUp({ sendReceipts: false }, { throughputPerSecond: 20 });
    const started = Date.now();
    const outcomes = await provider.send(Array.from({ length: 10 }, (_, i) => msg(`t${i}`)));
    expect(outcomes.every((o) => o.status === "accepted")).toBe(true);
    // 10 messages at 20/s: the last one goes out at least 9 * 50 ms after the first.
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });

  it("keeps the link alive with enquire_link", async () => {
    const { sim, provider } = await setUp(
      { sendReceipts: false },
      { session: { ...FAST_SESSION, enquireLinkIntervalMs: 40 } },
    );
    await provider.connect();
    await waitFor(() => sim.stats.enquireLinks >= 2, 2_000);
  });

  it("rejects submits after close and unbinds cleanly", async () => {
    const { sim, provider } = await setUp({ sendReceipts: false });
    await provider.send([msg("one")]);
    await provider.close();
    expect(provider.session.state).toBe("closed");
    expect(sim.received.some((p) => p.command === "unbind")).toBe(true);
    await expect(provider.session.submit({})).rejects.toBeInstanceOf(SmppSessionClosedError);
  });
});
