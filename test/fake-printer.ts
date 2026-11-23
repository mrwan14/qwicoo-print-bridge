import net from "node:net";

const OK = 0x12;

export type FakeState = "READY" | "PAPER_OUT" | "COVER_OPEN" | "PAPER_LOW" | "SILENT";

/** A pretend network thermal printer on port 9100 semantics: records bytes, answers DLE EOT. */
export class FakePrinter {
  received: Buffer[] = [];
  state: FakeState = "READY";
  private server = net.createServer((socket) => this.handle(socket));
  port = 0;

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", () => resolve()));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Bytes from all print jobs, without status queries. */
  printed(): Buffer {
    return Buffer.concat(this.received);
  }

  private reply(n: number): number {
    if (this.state === "PAPER_OUT") return [OK | 0x08, OK | 0x20, OK | 0x60][[1, 2, 4].indexOf(n)];
    if (this.state === "COVER_OPEN") return [OK | 0x08, OK | 0x04, OK][[1, 2, 4].indexOf(n)];
    if (this.state === "PAPER_LOW") return [OK, OK, OK | 0x0c][[1, 2, 4].indexOf(n)];
    return OK;
  }

  private handle(socket: net.Socket): void {
    const chunks: Buffer[] = [];
    socket.on("data", (data) => {
      let rest = data;
      // Answer DLE EOT n wherever it appears; keep everything else as print data.
      while (rest.length) {
        const at = rest.indexOf(Buffer.from([0x10, 0x04]));
        if (at === -1 || at + 2 >= rest.length) {
          chunks.push(rest);
          break;
        }
        if (at > 0) chunks.push(rest.subarray(0, at));
        const n = rest[at + 2];
        if (this.state !== "SILENT") socket.write(Buffer.from([this.reply(n)]));
        rest = rest.subarray(at + 3);
      }
    });
    socket.on("end", () => {
      if (chunks.length) this.received.push(Buffer.concat(chunks));
      socket.end();
    });
    socket.on("error", () => undefined);
  }
}
