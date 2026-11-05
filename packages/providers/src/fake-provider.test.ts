import { describe, expect, it } from "vitest";
import { FakeProvider } from "./fake-provider.js";
import type { OutboundMessage } from "./provider.js";

const msg = (id: string, to = "+34600000000"): OutboundMessage => ({
  id,
  to,
  senderId: "BIGSPINS",
  text: "hello {{domain}}",
  encoding: "GSM_7BIT",
  route: "fake-1",
  country: "ES",
});

describe("FakeProvider", () => {
  it("accepts every message by default and returns provider ids", async () => {
    const p = new FakeProvider();
    const out = await p.send([msg("a"), msg("b")]);
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.status === "accepted")).toBe(true);
  });

  it("fails a configurable share of messages deterministically", async () => {
    const p = new FakeProvider({ failEvery: 10 });
    const batch = Array.from({ length: 100 }, (_, i) => msg(`m${i}`));
    const out = await p.send(batch);
    expect(out.filter((o) => o.status === "failed")).toHaveLength(10);
    expect(out.filter((o) => o.status === "accepted")).toHaveLength(90);
  });

  it("emits a delivery receipt for accepted messages when asked", async () => {
    const p = new FakeProvider();
    const [out] = await p.send([msg("a")]);
    if (out?.status !== "accepted") throw new Error("expected accepted");
    const receipt = p.parseDeliveryReceipt({ id: out.providerMessageId, stat: "DELIVRD" });
    expect(receipt).toEqual({
      providerMessageId: out.providerMessageId,
      status: "delivered",
      at: expect.any(Date),
    });
    expect(p.parseDeliveryReceipt({ nonsense: true })).toBeNull();
  });

  it("prices known routes and rejects unknown ones", async () => {
    const p = new FakeProvider({ prices: { "fake-1:ES": 0.025 } });
    expect(await p.priceFor("fake-1", "ES")).toBe(0.025);
    expect(await p.priceFor("fake-1", "FR")).toBeNull();
  });

  it("validates sender ids: alphanumeric 3 to 11 characters", () => {
    const p = new FakeProvider();
    expect(p.validateSenderId("BIGSPINS", "ES")).toEqual({ ok: true });
    expect(p.validateSenderId("AB", "ES").ok).toBe(false);
    expect(p.validateSenderId("TOOLONGSENDER", "ES").ok).toBe(false);
    expect(p.validateSenderId("bad id!", "ES").ok).toBe(false);
  });

  it("records what it sent so tests can assert on it", async () => {
    const p = new FakeProvider();
    await p.send([msg("a"), msg("b")]);
    expect(p.sent.map((m) => m.id)).toEqual(["a", "b"]);
  });
});
