/// <reference path="../smpp-types.d.ts" />
/**
 * A managed SMPP transceiver session on top of node-smpp.
 *
 * - connects (`smpp://` or `ssmpp://` for TLS) and binds as a transceiver;
 * - keeps the link alive with `enquire_link` and drops it when the SMSC stops answering;
 * - reconnects with exponential backoff (1 s .. 60 s by default) after any close or error;
 * - bounds the number of in-flight `submit_sm` (the window) and optionally the submit rate;
 * - emits `deliver_sm` for delivery receipts and inbound messages (acknowledged automatically).
 *
 * Phone numbers never reach the logger: use {@link maskPhone} for anything that mentions one.
 */

import { EventEmitter } from "node:events";
import smpp from "smpp";
import { maskPhone } from "./mask-phone.js";

export interface SmppLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface SmppSessionOptions {
  host: string;
  port: number;
  systemId: string;
  password: string;
  systemType?: string;
  /** Connect with TLS (`ssmpp://`). Default false. */
  tls?: boolean;
  /** Maximum number of `submit_sm` awaiting a response. Default 10. */
  windowSize?: number;
  /** Maximum `submit_sm` per second. Default unlimited. */
  throughputPerSecond?: number;
  /** `enquire_link` period in ms. Default 30 000. */
  enquireLinkIntervalMs?: number;
  /** First reconnect delay in ms. Default 1 000. */
  reconnectMinMs?: number;
  /** Reconnect delay cap in ms. Default 60 000. */
  reconnectMaxMs?: number;
  /** TCP connect + bind timeout in ms. Default 10 000. */
  connectTimeoutMs?: number;
  /** How long a submit may wait (queued + in flight) before it fails, in ms. Default 60 000. */
  submitTimeoutMs?: number;
  /** How long `ready()` / `connect()` wait for a bind, in ms. Default 30 000. */
  bindTimeoutMs?: number;
  logger?: SmppLogger;
}

export type SmppSessionState = "idle" | "connecting" | "bound" | "reconnecting" | "closed";

export interface SubmitSmResult {
  /** SMPP command_status of the `submit_sm_resp` (0 = ESME_ROK). */
  commandStatus: number;
  /** Provider message id (empty when the submit was rejected). */
  messageId: string;
}

/** The session was closed (or dropped) before the request completed. */
export class SmppSessionClosedError extends Error {
  override readonly name = "SmppSessionClosedError";
}

/** The SMSC refused the bind, or no bind could be established in time. */
export class SmppBindError extends Error {
  override readonly name = "SmppBindError";
  readonly commandStatus: number | undefined;

  constructor(message: string, commandStatus?: number) {
    super(message);
    this.commandStatus = commandStatus;
  }
}

/** A submit waited longer than `submitTimeoutMs`. */
export class SmppTimeoutError extends Error {
  override readonly name = "SmppTimeoutError";
}

export interface SmppSessionEvents {
  bound: [];
  disconnected: [reason: string];
  bindFailed: [commandStatus: number];
  deliver_sm: [pdu: smpp.PDU];
  error: [error: Error];
}

interface Pending {
  params: Record<string, unknown>;
  resolve: (result: SubmitSmResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const SILENT_LOGGER: SmppLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const DEFAULTS = {
  windowSize: 10,
  enquireLinkIntervalMs: 30_000,
  reconnectMinMs: 1_000,
  reconnectMaxMs: 60_000,
  connectTimeoutMs: 10_000,
  submitTimeoutMs: 60_000,
  bindTimeoutMs: 30_000,
} as const;

const INTERFACE_VERSION_34 = 0x34;

export class SmppSession extends EventEmitter<SmppSessionEvents> {
  state: SmppSessionState = "idle";

  private readonly opts: SmppSessionOptions;
  private readonly log: SmppLogger;
  private readonly windowSize: number;
  private readonly submitIntervalMs: number;

  private session: smpp.Session | undefined;
  private readonly queue: Pending[] = [];
  private readonly inFlight = new Set<Pending>();
  private readonly waiters = new Set<Waiter>();

  private attempt = 0;
  private boundCount = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private pumpTimer: NodeJS.Timeout | undefined;
  private enquireTimer: NodeJS.Timeout | undefined;
  private bindTimer: NodeJS.Timeout | undefined;
  private enquirePending = false;
  private nextSlotAt = 0;
  private lastError: Error | undefined;

  constructor(opts: SmppSessionOptions) {
    super();
    this.opts = opts;
    this.log = opts.logger ?? SILENT_LOGGER;
    this.windowSize = Math.max(1, opts.windowSize ?? DEFAULTS.windowSize);
    const tps = opts.throughputPerSecond ?? 0;
    this.submitIntervalMs = tps > 0 ? 1000 / tps : 0;
  }

  /** Number of successful binds so far (useful to observe reconnects). */
  get binds(): number {
    return this.boundCount;
  }

  /** In-flight plus queued submits. */
  get pendingCount(): number {
    return this.inFlight.size + this.queue.length;
  }

  /**
   * Open the connection and bind. Resolves after the first successful bind; rejects with
   * {@link SmppBindError} when the SMSC refuses the bind or none happens within `bindTimeoutMs`.
   * The session keeps reconnecting in the background either way until `close()`.
   */
  connect(): Promise<void> {
    if (this.state === "closed") {
      return Promise.reject(new SmppSessionClosedError("session is closed"));
    }
    if (this.state === "idle") {
      this.state = "connecting";
      this.open();
    }
    return this.ready();
  }

  /** Resolve when bound (immediately if already bound), reject on bind failure or timeout. */
  ready(timeoutMs: number = this.opts.bindTimeoutMs ?? DEFAULTS.bindTimeoutMs): Promise<void> {
    if (this.state === "bound") return Promise.resolve();
    if (this.state === "closed") {
      return Promise.reject(new SmppSessionClosedError("session is closed"));
    }
    if (this.state === "idle") {
      this.state = "connecting";
      this.open();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(
            new SmppBindError(
              `not bound within ${timeoutMs} ms${this.lastError ? `: ${this.lastError.message}` : ""}`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  /**
   * Queue a `submit_sm`. Resolves with the response status and message id; rejects with
   * {@link SmppSessionClosedError} when the link drops while the PDU is in flight, with
   * {@link SmppTimeoutError} when `submitTimeoutMs` elapses first.
   */
  submit(params: Record<string, unknown>): Promise<SubmitSmResult> {
    if (this.state === "closed") {
      return Promise.reject(new SmppSessionClosedError("session is closed"));
    }
    const timeoutMs = this.opts.submitTimeoutMs ?? DEFAULTS.submitTimeoutMs;
    return new Promise<SubmitSmResult>((resolve, reject) => {
      const pending: Pending = {
        params,
        resolve,
        reject,
        timer: setTimeout(() => this.expire(pending, timeoutMs), timeoutMs),
      };
      this.queue.push(pending);
      this.pump();
    });
  }

  /** Unbind cleanly, stop reconnecting and fail whatever is still pending. */
  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    this.clearTimers();
    const closedError = new SmppSessionClosedError("session closed");
    this.failAll(closedError);
    const session = this.session;
    this.session = undefined;
    if (session === undefined || session.closed) return;

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const fallback = setTimeout(() => {
        session.destroy(finish);
      }, 2_000);
      const end = () => {
        clearTimeout(fallback);
        session.close(finish);
      };
      const sent = session.unbind({}, end, undefined, end);
      if (!sent) end();
    });
  }

  // --- connection lifecycle -------------------------------------------------------------------

  private open(): void {
    const { host, port, tls = false } = this.opts;
    const url = `${tls ? "ssmpp" : "smpp"}://${host}:${port}`;
    const connectTimeoutMs = this.opts.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;
    this.log.info("smpp: connecting", { url, attempt: this.attempt });

    const session = smpp.connect(
      { url, connectTimeout: connectTimeoutMs, auto_enquire_link_period: 0 },
      () => this.bind(session),
    );
    this.session = session;

    session.on("error", (error: Error) => {
      this.lastError = error;
      this.log.warn("smpp: socket error", { error: error.message });
      if (this.listenerCount("error") > 0) this.emit("error", error);
      session.destroy();
    });
    session.on("close", () => this.onClosed(session));
    session.on("deliver_sm", (pdu: smpp.PDU) => {
      session.send(pdu.response());
      this.emit("deliver_sm", pdu);
    });
    session.on("enquire_link", (pdu: smpp.PDU) => {
      session.send(pdu.response());
    });
    session.on("unbind", (pdu: smpp.PDU) => {
      this.log.info("smpp: unbind requested by the SMSC");
      session.send(pdu.response());
      session.close();
    });

    this.bindTimer = setTimeout(() => {
      this.lastError = new SmppBindError(`no bind within ${connectTimeoutMs} ms`);
      this.log.warn("smpp: bind timed out");
      session.destroy();
    }, connectTimeoutMs);
  }

  private bind(session: smpp.Session): void {
    const { systemId, password, systemType = "" } = this.opts;
    session.bind_transceiver(
      {
        system_id: systemId,
        password,
        system_type: systemType,
        interface_version: INTERFACE_VERSION_34,
      },
      (resp: smpp.PDU) => {
        if (this.session !== session) return;
        this.clearBindTimer();
        if (resp.command_status !== 0) {
          const error = new SmppBindError(
            `bind rejected with status 0x${resp.command_status.toString(16)}`,
            resp.command_status,
          );
          this.lastError = error;
          this.log.error("smpp: bind rejected", { commandStatus: resp.command_status });
          this.emit("bindFailed", resp.command_status);
          this.rejectWaiters(error);
          session.close();
          return;
        }
        this.state = "bound";
        this.attempt = 0;
        this.boundCount += 1;
        this.lastError = undefined;
        this.log.info("smpp: bound", { binds: this.boundCount });
        this.startEnquireLink(session);
        this.emit("bound");
        this.resolveWaiters();
        this.pump();
      },
      undefined,
      (_pdu: smpp.PDU, error?: Error) => {
        this.lastError = error ?? new Error("bind could not be written");
        session.destroy();
      },
    );
  }

  private onClosed(session: smpp.Session): void {
    if (this.session !== session) return;
    this.session = undefined;
    this.clearBindTimer();
    this.stopEnquireLink();
    const reason = this.lastError?.message ?? "connection closed";
    this.log.warn("smpp: disconnected", { reason, inFlight: this.inFlight.size });
    const closedError = new SmppSessionClosedError(`link dropped: ${reason}`);
    for (const pending of this.inFlight) {
      clearTimeout(pending.timer);
      pending.reject(closedError);
    }
    this.inFlight.clear();
    this.emit("disconnected", reason);
    if (this.state === "closed") return;
    this.state = "reconnecting";
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const min = this.opts.reconnectMinMs ?? DEFAULTS.reconnectMinMs;
    const max = this.opts.reconnectMaxMs ?? DEFAULTS.reconnectMaxMs;
    const delay = Math.min(max, min * 2 ** this.attempt);
    this.attempt += 1;
    this.log.info("smpp: reconnecting", { inMs: delay, attempt: this.attempt });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.state !== "reconnecting") return;
      this.state = "connecting";
      this.open();
    }, delay);
  }

  // --- keepalive ------------------------------------------------------------------------------

  private startEnquireLink(session: smpp.Session): void {
    const interval = this.opts.enquireLinkIntervalMs ?? DEFAULTS.enquireLinkIntervalMs;
    this.enquirePending = false;
    this.enquireTimer = setInterval(() => {
      if (this.enquirePending) {
        this.lastError = new Error("enquire_link unanswered");
        this.log.warn("smpp: enquire_link unanswered, dropping the link");
        session.destroy();
        return;
      }
      this.enquirePending = true;
      session.enquire_link({}, () => {
        this.enquirePending = false;
      });
    }, interval);
  }

  private stopEnquireLink(): void {
    if (this.enquireTimer !== undefined) {
      clearInterval(this.enquireTimer);
      this.enquireTimer = undefined;
    }
    this.enquirePending = false;
  }

  // --- submit window --------------------------------------------------------------------------

  private pump(): void {
    const session = this.session;
    if (session === undefined || this.state !== "bound") return;
    while (this.queue.length > 0 && this.inFlight.size < this.windowSize) {
      if (this.submitIntervalMs > 0) {
        const now = Date.now();
        const slot = Math.max(this.nextSlotAt, now);
        if (slot > now) {
          if (this.pumpTimer === undefined) {
            this.pumpTimer = setTimeout(() => {
              this.pumpTimer = undefined;
              this.pump();
            }, slot - now);
          }
          return;
        }
        this.nextSlotAt = slot + this.submitIntervalMs;
      }
      const pending = this.queue.shift();
      if (pending === undefined) return;
      this.dispatch(session, pending);
    }
  }

  private dispatch(session: smpp.Session, pending: Pending): void {
    this.inFlight.add(pending);
    session.submit_sm(
      pending.params,
      (resp: smpp.PDU) => {
        const messageId = typeof resp.message_id === "string" ? resp.message_id : "";
        if (resp.command_status !== 0) {
          this.log.debug("smpp: submit_sm rejected", {
            commandStatus: resp.command_status,
            to: maskPhone(String(pending.params.destination_addr ?? "")),
          });
        }
        this.settle(pending, { commandStatus: resp.command_status, messageId });
      },
      undefined,
      (_pdu: smpp.PDU, error?: Error) => {
        this.fail(pending, new SmppSessionClosedError(error?.message ?? "socket not writable"));
      },
    );
  }

  private settle(pending: Pending, result: SubmitSmResult): void {
    if (!this.inFlight.delete(pending)) return;
    clearTimeout(pending.timer);
    pending.resolve(result);
    this.pump();
  }

  private fail(pending: Pending, error: Error): void {
    if (!this.inFlight.delete(pending)) return;
    clearTimeout(pending.timer);
    pending.reject(error);
    this.pump();
  }

  private expire(pending: Pending, timeoutMs: number): void {
    const error = new SmppTimeoutError(`submit_sm not answered within ${timeoutMs} ms`);
    const queued = this.queue.indexOf(pending);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      pending.reject(error);
      return;
    }
    this.fail(pending, error);
  }

  // --- helpers --------------------------------------------------------------------------------

  private failAll(error: Error): void {
    for (const pending of this.queue) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.queue.length = 0;
    for (const pending of this.inFlight) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.inFlight.clear();
    this.rejectWaiters(error);
  }

  private resolveWaiters(): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.waiters.clear();
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private clearBindTimer(): void {
    if (this.bindTimer !== undefined) {
      clearTimeout(this.bindTimer);
      this.bindTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.clearBindTimer();
    this.stopEnquireLink();
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.pumpTimer !== undefined) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = undefined;
    }
  }
}
