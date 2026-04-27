import net, { Socket } from "net";

const STX = 0x02;
const ETX = 0x03;
const STANDARD_PREFIX_HEX = "0233303330333033303830"; // STX + "030303080"
const STATUS_REQUEST_HEX = "303303"; // "03" + ETX
const PORT = 2000;

export interface ProbeResult {
  reachable: boolean;
  rttMs?: number;
  responseBytes?: number;
  statusPacketValid?: boolean;
  responseHex?: string;
  error?: string;
}

export interface RawResult {
  sentHex: string;
  receivedHex: string;
  receivedBytes: number;
  totalMs: number;
  framedPackets: string[]; // ASCII payloads of any STX/ETX-framed messages received
  error?: string;
}

export interface RawOptions {
  /** When true, the standard prefix (STX + bridge header) is prepended. Default true. */
  prefix?: boolean;
  /** When true, ETX (0x03) is appended to the command. Default false — the
   *  documented protocol commands include their own ETX (e.g. status request
   *  is "303303", which ends in 0x03). */
  appendEtx?: boolean;
  /** Milliseconds to wait for response data after sending. Default 2000. */
  timeoutMs?: number;
  /** Connect timeout in ms. Default 5000. */
  connectTimeoutMs?: number;
}

export interface TailHandle {
  /** Stop tailing and close the connection. */
  stop: () => void;
  /** Resolves when the connection closes for any reason. */
  done: Promise<void>;
}

/**
 * Low-level protocol toolkit for the Valor B6R-WME / Mertik GV60 TCP bridge.
 *
 * Separate from FireplaceCliController because exploration tooling needs
 * raw byte access without ignition state machines or retry logic.
 */
export class ProtocolExplorer {
  /**
   * Open a TCP connection, send a status request, measure round-trip latency,
   * verify the response is a valid 106-char status packet. Critical for diagnosing
   * the WiFi module's "stuck" state (red+green LEDs): if probe succeeds, local
   * control is unaffected even if the cloud bridge is hung.
   */
  public static async probe(ip: string, timeoutMs = 5000): Promise<ProbeResult> {
    const start = Date.now();
    const sock = new net.Socket();
    let buffer = Buffer.alloc(0);
    let resolved = false;

    return new Promise<ProbeResult>((resolve) => {
      const finish = (result: ProbeResult) => {
        if (resolved) return;
        resolved = true;
        sock.destroy();
        resolve(result);
      };

      const overall = setTimeout(() => {
        finish({
          reachable: false,
          error: `timeout after ${timeoutMs}ms`,
          rttMs: Date.now() - start,
        });
      }, timeoutMs);

      sock.once("connect", () => {
        const packet = Buffer.from(STANDARD_PREFIX_HEX + STATUS_REQUEST_HEX, "hex");
        sock.write(packet);
      });

      sock.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const stx = buffer.indexOf(STX);
        const etx = stx >= 0 ? buffer.indexOf(ETX, stx + 1) : -1;
        if (stx >= 0 && etx >= 0) {
          clearTimeout(overall);
          const payload = buffer.subarray(stx + 1, etx);
          finish({
            reachable: true,
            rttMs: Date.now() - start,
            responseBytes: buffer.length,
            statusPacketValid: payload.length === 106,
            responseHex: buffer.toString("hex"),
          });
        }
      });

      sock.once("error", (err) => {
        clearTimeout(overall);
        finish({
          reachable: false,
          error: err.message,
          rttMs: Date.now() - start,
        });
      });

      sock.once("close", () => {
        if (!resolved) {
          clearTimeout(overall);
          finish({
            reachable: false,
            error: "connection closed before response",
            rttMs: Date.now() - start,
          });
        }
      });

      sock.connect(PORT, ip);
    });
  }

  /**
   * Send arbitrary hex bytes and capture the raw response. Intended for protocol
   * exploration: probing for unmapped GV60 commands, looking for a soft-reset
   * command, observing how the module responds to malformed input, etc.
   *
   * By default, wraps the input as: STX + "030303080" + <input> + ETX (matching
   * the existing controller's framing). Use `--bare` (prefix:false) to send the
   * exact bytes verbatim.
   */
  public static async sendRaw(ip: string, hex: string, options: RawOptions = {}): Promise<RawResult> {
    const prefix = options.prefix !== false;
    const appendEtx = prefix && options.appendEtx === true;
    const timeoutMs = options.timeoutMs ?? 2000;
    const connectTimeoutMs = options.connectTimeoutMs ?? 5000;

    const cleaned = hex.replace(/\s+/g, "").toLowerCase();
    if (!/^[0-9a-f]*$/.test(cleaned) || cleaned.length % 2 !== 0) {
      return {
        sentHex: hex,
        receivedHex: "",
        receivedBytes: 0,
        totalMs: 0,
        framedPackets: [],
        error: "input must be valid hex with an even number of digits",
      };
    }

    let toSend = cleaned;
    if (prefix) {
      toSend = STANDARD_PREFIX_HEX + cleaned + (appendEtx ? "03" : "");
    }

    const start = Date.now();
    const sock = new net.Socket();
    let buffer = Buffer.alloc(0);
    let connected = false;

    return new Promise<RawResult>((resolve) => {
      let settled = false;
      const finish = (result: RawResult) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        resolve(result);
      };

      const connectTimer = setTimeout(() => {
        if (!connected) {
          finish({
            sentHex: toSend,
            receivedHex: "",
            receivedBytes: 0,
            totalMs: Date.now() - start,
            framedPackets: [],
            error: `connect timeout after ${connectTimeoutMs}ms`,
          });
        }
      }, connectTimeoutMs);

      let readTimer: NodeJS.Timeout | null = null;

      const completeAfter = (delayMs: number) => {
        if (readTimer) clearTimeout(readTimer);
        readTimer = setTimeout(() => {
          finish({
            sentHex: toSend,
            receivedHex: buffer.toString("hex"),
            receivedBytes: buffer.length,
            totalMs: Date.now() - start,
            framedPackets: extractFramedPackets(buffer),
          });
        }, delayMs);
      };

      sock.once("connect", () => {
        connected = true;
        clearTimeout(connectTimer);
        sock.write(Buffer.from(toSend, "hex"));
        completeAfter(timeoutMs);
      });

      sock.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        // Reset read timer on each new chunk so we capture multi-packet responses.
        completeAfter(Math.min(timeoutMs, 500));
      });

      sock.once("error", (err) => {
        clearTimeout(connectTimer);
        if (readTimer) clearTimeout(readTimer);
        finish({
          sentHex: toSend,
          receivedHex: buffer.toString("hex"),
          receivedBytes: buffer.length,
          totalMs: Date.now() - start,
          framedPackets: extractFramedPackets(buffer),
          error: err.message,
        });
      });

      sock.once("close", () => {
        clearTimeout(connectTimer);
        if (readTimer) clearTimeout(readTimer);
        finish({
          sentHex: toSend,
          receivedHex: buffer.toString("hex"),
          receivedBytes: buffer.length,
          totalMs: Date.now() - start,
          framedPackets: extractFramedPackets(buffer),
        });
      });

      sock.connect(PORT, ip);
    });
  }

  /**
   * Open a long-lived connection and call `onPacket` for every STX/ETX-framed
   * message received. Caller must invoke `stop()` to close the connection.
   * Sends a status request every `pollIntervalMs` to keep the conversation alive.
   */
  public static tail(
    ip: string,
    onPacket: (payload: string, raw: Buffer) => void,
    pollIntervalMs = 5000,
  ): TailHandle {
    const sock = new net.Socket();
    let buffer = Buffer.alloc(0);
    let stopped = false;
    let pollTimer: NodeJS.Timeout | null = null;

    const done = new Promise<void>((resolve) => {
      sock.once("close", () => {
        if (pollTimer) clearInterval(pollTimer);
        resolve();
      });
    });

    sock.once("connect", () => {
      const send = () => {
        if (stopped) return;
        try {
          sock.write(Buffer.from(STANDARD_PREFIX_HEX + STATUS_REQUEST_HEX, "hex"));
        } catch {
          // socket closed; close handler will clean up
        }
      };
      send();
      pollTimer = setInterval(send, pollIntervalMs);
    });

    sock.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const stx = buffer.indexOf(STX);
        if (stx < 0) {
          buffer = Buffer.alloc(0);
          break;
        }
        const etx = buffer.indexOf(ETX, stx + 1);
        if (etx < 0) {
          if (stx > 0) buffer = buffer.subarray(stx);
          break;
        }
        const frame = buffer.subarray(stx, etx + 1);
        const payloadBuf = buffer.subarray(stx + 1, etx);
        onPacket(payloadBuf.toString("ascii"), frame);
        buffer = buffer.subarray(etx + 1);
      }
    });

    sock.on("error", () => {
      // Surfaced via close handler.
    });

    sock.connect(PORT, ip);

    return {
      stop: () => {
        stopped = true;
        if (pollTimer) clearInterval(pollTimer);
        sock.destroy();
      },
      done,
    };
  }
}

function extractFramedPackets(buffer: Buffer): string[] {
  const packets: string[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const stx = buffer.indexOf(STX, cursor);
    if (stx < 0) break;
    const etx = buffer.indexOf(ETX, stx + 1);
    if (etx < 0) break;
    packets.push(buffer.subarray(stx + 1, etx).toString("ascii"));
    cursor = etx + 1;
  }
  return packets;
}
