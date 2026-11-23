import net from "node:net";

import { STATUS_QUERIES, parseStatus, type PrinterStatus } from "../../core/escpos";
import type { PrinterTransport } from "../../core/transport";

type Options = { connectTimeoutMs?: number; replyTimeoutMs?: number; writeTimeoutMs?: number };

/** Raw TCP to a network thermal printer (port 9100), the most reliable way to print and read status. */
export class NetworkTransport implements PrinterTransport {
  private readonly connectTimeoutMs: number;
  private readonly replyTimeoutMs: number;
  private readonly writeTimeoutMs: number;

  constructor(
    readonly host: string,
    readonly port = 9100,
    options: Options = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 4000;
    this.replyTimeoutMs = options.replyTimeoutMs ?? 1500;
    this.writeTimeoutMs = options.writeTimeoutMs ?? 20000;
  }

  describe(): string {
    return `${this.host}:${this.port}`;
  }

  private connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Printer not reachable at ${this.describe()}`));
      }, this.connectTimeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", () => {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`Printer not reachable at ${this.describe()}`));
      });
    });
  }

  async print(bytes: Uint8Array): Promise<void> {
    const socket = await this.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Printer at ${this.describe()} stopped accepting data`));
      }, this.writeTimeoutMs);
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.end(Buffer.from(bytes), () => {
        clearTimeout(timer);
        resolve();
      });
    });
    socket.destroy();
  }

  async status(): Promise<PrinterStatus> {
    let socket: net.Socket;
    try {
      socket = await this.connect();
    } catch {
      return "OFFLINE";
    }
    const replies: number[] = [];
    const queue: number[] = [];
    let waiter: ((byte: number | null) => void) | null = null;
    socket.on("data", (data) => {
      for (const byte of data) {
        if (waiter) {
          const w = waiter;
          waiter = null;
          w(byte);
        } else queue.push(byte);
      }
    });
    socket.on("error", () => undefined);
    const nextByte = () =>
      new Promise<number | null>((resolve) => {
        if (queue.length) return resolve(queue.shift() as number);
        const timer = setTimeout(() => {
          waiter = null;
          resolve(null);
        }, this.replyTimeoutMs);
        waiter = (byte) => {
          clearTimeout(timer);
          resolve(byte);
        };
      });
    try {
      for (const query of STATUS_QUERIES) {
        socket.write(Buffer.from(query));
        const byte = await nextByte();
        if (byte === null) return "UNKNOWN";
        replies.push(byte);
      }
      return parseStatus(replies);
    } finally {
      socket.destroy();
    }
  }
}
