/**
 * In-process SMPP simulator for tests and local development (no Docker needed).
 *
 * Accepts any bind, answers `submit_sm` with incrementing message ids, applies a configurable
 * behaviour (invalid destinations, throttling, slow responses) and sends a delivery receipt for
 * every accepted part after a short delay. Everything it receives is kept in `received`.
 */

import smpp from "smpp";

export interface SimulatorBehaviour {
  /** Destinations ending with this suffix are rejected with ESME_RINVDSTADR. Default `"99"`. */
  invalidDestinationSuffix?: string;
  /** Destinations ending with this suffix get an UNDELIV receipt. Default `"98"`. */
  undeliverableSuffix?: string;
  /** Every Nth submit_sm (1-based, counted per simulator) is answered ESME_RTHROTTLED. 0 = never. */
  throttleEvery?: number;
  /** Delay before the `submit_sm_resp`, in ms. Default 0. */
  responseDelayMs?: number;
  /** Delay before the receipt `deliver_sm`, in ms. Default 20. */
  receiptDelayMs?: number;
  /** Send delivery receipts for accepted parts. Default true. */
  sendReceipts?: boolean;
  /** command_status returned to binds. Default 0 (accept). */
  bindStatus?: number;
  /** Decide the submit_sm status yourself; return undefined to fall back to the rules above. */
  submitStatus?: (pdu: smpp.PDU, index: number) => number | undefined;
}

export interface SimulatorStats {
  binds: number;
  submits: number;
  enquireLinks: number;
  receiptAcks: number;
  /** Highest number of submit_sm awaiting a response at any one time. */
  maxInFlight: number;
}

export interface SmppSimulator {
  port: number;
  /** Every request PDU received, in order (responses are not recorded). */
  received: smpp.PDU[];
  stats: SimulatorStats;
  close(): Promise<void>;
}

export interface StartSimulatorOptions {
  /** 0 (default) picks a free port. */
  port?: number;
  host?: string;
  behaviour?: SimulatorBehaviour;
}

const ESM_CLASS_DELIVERY_RECEIPT = 0x04;
const MESSAGE_STATE_DELIVERED = 2;
const MESSAGE_STATE_UNDELIVERABLE = 5;

function smppTimestamp(date: Date): string {
  const two = (n: number) => n.toString().padStart(2, "0");
  return (
    two(date.getUTCFullYear() % 100) +
    two(date.getUTCMonth() + 1) +
    two(date.getUTCDate()) +
    two(date.getUTCHours()) +
    two(date.getUTCMinutes())
  );
}

function messageText(pdu: smpp.PDU): string {
  const value = pdu.short_message;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "message" in value) {
    const inner = (value as smpp.DecodedMessage).message;
    return typeof inner === "string" ? inner : inner.toString("latin1");
  }
  return "";
}

export function startSimulator(options: StartSimulatorOptions = {}): Promise<SmppSimulator> {
  const behaviour = options.behaviour ?? {};
  const invalidSuffix = behaviour.invalidDestinationSuffix ?? "99";
  const undeliverableSuffix = behaviour.undeliverableSuffix ?? "98";
  const throttleEvery = behaviour.throttleEvery ?? 0;
  const responseDelayMs = behaviour.responseDelayMs ?? 0;
  const receiptDelayMs = behaviour.receiptDelayMs ?? 20;
  const sendReceipts = behaviour.sendReceipts ?? true;
  const bindStatus = behaviour.bindStatus ?? 0;

  const received: smpp.PDU[] = [];
  const stats: SimulatorStats = {
    binds: 0,
    submits: 0,
    enquireLinks: 0,
    receiptAcks: 0,
    maxInFlight: 0,
  };
  const timers = new Set<NodeJS.Timeout>();
  let messageCounter = 0;
  let inFlight = 0;

  const later = (ms: number, fn: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  const submitStatusFor = (pdu: smpp.PDU, index: number): number => {
    const override = behaviour.submitStatus?.(pdu, index);
    if (override !== undefined) return override;
    if (throttleEvery > 0 && index % throttleEvery === 0) {
      return smpp.errors.ESME_RTHROTTLED ?? 0x58;
    }
    if (String(pdu.destination_addr ?? "").endsWith(invalidSuffix)) {
      return smpp.errors.ESME_RINVDSTADR ?? 0x0b;
    }
    return 0;
  };

  const sendReceipt = (session: smpp.Session, submit: smpp.PDU, messageId: string): void => {
    if (session.closed) return;
    const destination = String(submit.destination_addr ?? "");
    const undeliverable = destination.endsWith(undeliverableSuffix);
    const stat = undeliverable ? "UNDELIV" : "DELIVRD";
    const err = undeliverable ? "001" : "000";
    const now = smppTimestamp(new Date());
    const excerpt = messageText(submit)
      .slice(0, 20)
      .replace(/[^\x20-\x7e]/g, "?");
    session.deliver_sm({
      source_addr_ton: submit.dest_addr_ton,
      source_addr_npi: submit.dest_addr_npi,
      source_addr: destination,
      dest_addr_ton: submit.source_addr_ton,
      dest_addr_npi: submit.source_addr_npi,
      destination_addr: String(submit.source_addr ?? ""),
      esm_class: ESM_CLASS_DELIVERY_RECEIPT,
      data_coding: 0,
      short_message: `id:${messageId} sub:001 dlvrd:${undeliverable ? "000" : "001"} submit date:${now} done date:${now} stat:${stat} err:${err} text:${excerpt}`,
      receipted_message_id: messageId,
      message_state: undeliverable ? MESSAGE_STATE_UNDELIVERABLE : MESSAGE_STATE_DELIVERED,
    });
  };

  const handleSubmit = (session: smpp.Session, pdu: smpp.PDU): void => {
    stats.submits += 1;
    const index = stats.submits;
    inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    const status = submitStatusFor(pdu, index);
    const respond = () => {
      inFlight -= 1;
      if (session.closed) return;
      if (status !== 0) {
        session.send(pdu.response({ command_status: status }));
        return;
      }
      messageCounter += 1;
      const messageId = `sim-${messageCounter}`;
      session.send(pdu.response({ message_id: messageId }));
      if (sendReceipts) later(receiptDelayMs, () => sendReceipt(session, pdu, messageId));
    };
    if (responseDelayMs > 0) later(responseDelayMs, respond);
    else respond();
  };

  const handle = (session: smpp.Session, pdu: smpp.PDU): void => {
    if (pdu.isResponse()) {
      if (pdu.command === "deliver_sm_resp") stats.receiptAcks += 1;
      return;
    }
    received.push(pdu);
    switch (pdu.command) {
      case "bind_transceiver":
      case "bind_transmitter":
      case "bind_receiver":
        stats.binds += 1;
        session.send(pdu.response({ system_id: "sendex-sim", command_status: bindStatus }));
        return;
      case "submit_sm":
        handleSubmit(session, pdu);
        return;
      case "enquire_link":
        stats.enquireLinks += 1;
        session.send(pdu.response());
        return;
      case "unbind":
        session.send(pdu.response());
        session.close();
        return;
      default:
        session.send(pdu.response());
    }
  };

  const server = smpp.createServer((session) => {
    session.on("error", () => {
      // A client that vanishes mid-session is normal in the reconnect tests.
    });
    session.on("pdu", (pdu: smpp.PDU) => handle(session, pdu));
  });

  return new Promise<SmppSimulator>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        received,
        stats,
        close: () =>
          new Promise<void>((done) => {
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
            for (const session of [...server.sessions]) session.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
