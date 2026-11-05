import { describe, expect, it } from "vitest";
import { commandStatusName, isRetryableStatus, SmppProvider } from "./smpp-provider.js";

const provider = () =>
  new SmppProvider({
    name: "23telecom",
    host: "127.0.0.1",
    port: 1,
    systemId: "test",
    password: "test",
    prices: { "23t-premium:ES": 0.031, "23t-premium:FR": 0.045 },
  });

describe("SmppProvider (no network)", () => {
  it("does not connect until asked", () => {
    const p = provider();
    expect(p.name).toBe("23telecom");
    expect(p.session.state).toBe("idle");
  });

  it("prices known routes and rejects unknown ones", async () => {
    const p = provider();
    expect(await p.priceFor("23t-premium", "ES")).toBe(0.031);
    expect(await p.priceFor("23t-premium", "DE")).toBeNull();
    expect(await p.priceFor("other", "ES")).toBeNull();
  });

  it("validates sender ids as 3 to 11 alphanumeric characters by default", () => {
    const p = provider();
    expect(p.validateSenderId("BIGSPINS", "ES")).toEqual({ ok: true });
    expect(p.validateSenderId("AB", "ES").ok).toBe(false);
    expect(p.validateSenderId("TOOLONGSENDER", "ES").ok).toBe(false);
    expect(p.validateSenderId("bad id!", "ES").ok).toBe(false);
  });

  it("lets the account override the sender id rules", () => {
    const p = new SmppProvider({
      name: "x",
      host: "127.0.0.1",
      port: 1,
      systemId: "a",
      password: "b",
      prices: {},
      senderIdRules: (sid, country) =>
        country === "FR" && /^\d+$/.test(sid)
          ? { ok: false, reason: "France requires an alphanumeric sender" }
          : { ok: true },
    });
    expect(p.validateSenderId("12345", "FR").ok).toBe(false);
    expect(p.validateSenderId("12345", "ES")).toEqual({ ok: true });
  });

  it("parses deliver_sm receipts", () => {
    const p = provider();
    expect(
      p.parseDeliveryReceipt({
        short_message: { message: "id:77 sub:001 dlvrd:001 stat:DELIVRD err:000 text:" },
        receipted_message_id: "77",
      }),
    ).toEqual({
      providerMessageId: "77",
      status: "delivered",
      errorCode: "000",
      at: expect.any(Date),
    });
    expect(p.parseDeliveryReceipt({ short_message: "hello" })).toBeNull();
  });

  it("names SMPP statuses and knows which are retryable", () => {
    expect(commandStatusName(0x58)).toBe("ESME_RTHROTTLED");
    expect(commandStatusName(0x14)).toBe("ESME_RMSGQFUL");
    expect(commandStatusName(0x0b)).toBe("ESME_RINVDSTADR");
    expect(commandStatusName(0x0a)).toBe("ESME_RINVSRCADR");
    expect(commandStatusName(0x4321)).toBe("ESME_0x00004321");
    expect(isRetryableStatus(0x58)).toBe(true);
    expect(isRetryableStatus(0x14)).toBe(true);
    expect(isRetryableStatus(0x0b)).toBe(false);
    expect(isRetryableStatus(0x0a)).toBe(false);
    expect(isRetryableStatus(0x08)).toBe(false);
  });
});
