/**
 * Minimal typings for the `smpp` package (node-smpp), limited to what Sendex uses.
 *
 * node-smpp is CommonJS and attaches `errors`, `consts` and the ESME_* codes to `module.exports`
 * in a loop, so under ESM only the default import (`import smpp from "smpp"`) sees them.
 */
declare module "smpp" {
  import type { EventEmitter } from "node:events";
  import type { Server as NetServer, Socket } from "node:net";

  namespace smpp {
    /** A decoded `short_message` / `message_payload` (node-smpp strips the UDH length byte). */
    interface DecodedMessage {
      udh?: Buffer[];
      message: string | Buffer;
    }

    interface PDU {
      command: string;
      command_id: number;
      command_status: number;
      sequence_number: number;
      isResponse(): boolean;
      response(options?: Record<string, unknown>): PDU;
      toBuffer(): Buffer;
      [field: string]: unknown;
    }

    interface PDUConstructor {
      new (command: string, options?: Record<string, unknown>): PDU;
      fromBuffer(buffer: Buffer): PDU | false;
      maxLength: number;
    }

    type ResponseCallback = (pdu: PDU) => void;
    type SendCallback = (pdu: PDU) => void;
    type FailureCallback = (pdu: PDU, error?: Error) => void;

    type CommandMethod = (
      options?: Record<string, unknown> | ResponseCallback,
      responseCallback?: ResponseCallback,
      sendCallback?: SendCallback,
      failureCallback?: FailureCallback,
    ) => boolean;

    interface Session extends EventEmitter {
      closed: boolean;
      socket: Socket;
      remoteAddress: string | null;
      send(
        pdu: PDU,
        responseCallback?: ResponseCallback,
        sendCallback?: SendCallback,
        failureCallback?: FailureCallback,
      ): boolean;
      close(callback?: () => void): void;
      destroy(callback?: () => void): void;
      pause(): void;
      resume(): void;
      bind_transceiver: CommandMethod;
      bind_transmitter: CommandMethod;
      bind_receiver: CommandMethod;
      submit_sm: CommandMethod;
      deliver_sm: CommandMethod;
      enquire_link: CommandMethod;
      unbind: CommandMethod;
      generic_nack: CommandMethod;
    }

    interface ConnectOptions {
      url?: string;
      host?: string;
      port?: number;
      tls?: boolean;
      rejectUnauthorized?: boolean;
      connectTimeout?: number;
      auto_enquire_link_period?: number;
      debug?: boolean;
    }

    interface ServerOptions {
      key?: string | Buffer;
      cert?: string | Buffer;
      debug?: boolean;
    }

    interface Server extends NetServer {
      sessions: Session[];
    }

    type SessionListener = (session: Session) => void;

    function connect(options: ConnectOptions, listener?: SessionListener): Session;
    function createServer(listener: SessionListener): Server;
    function createServer(options: ServerOptions, listener: SessionListener): Server;

    const PDU: PDUConstructor;
    const errors: Record<string, number>;
    const consts: {
      REGISTERED_DELIVERY: Record<string, number>;
      ESM_CLASS: Record<string, number>;
      MESSAGE_STATE: Record<string, number>;
      TON: Record<string, number>;
      NPI: Record<string, number>;
      ENCODING: Record<string, number>;
    };
  }

  export = smpp;
}
