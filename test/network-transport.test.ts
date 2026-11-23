import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NetworkTransport } from "../src/main/transports/network";
import { FakePrinter } from "./fake-printer";

let printer: FakePrinter;

beforeEach(async () => {
  printer = new FakePrinter();
  await printer.start();
});
afterEach(async () => printer.stop());

describe("network printer (port 9100)", () => {
  it("sends every byte of a job", async () => {
    const transport = new NetworkTransport("127.0.0.1", printer.port);
    const job = new Uint8Array(200_000).map((_, i) => i % 251);
    await transport.print(job);
    await new Promise((r) => setTimeout(r, 50));
    expect(printer.printed().equals(Buffer.from(job))).toBe(true);
  });

  it("reads the printer status", async () => {
    const transport = new NetworkTransport("127.0.0.1", printer.port);
    expect(await transport.status()).toBe("READY");
    printer.state = "PAPER_OUT";
    expect(await transport.status()).toBe("PAPER_OUT");
    printer.state = "COVER_OPEN";
    expect(await transport.status()).toBe("COVER_OPEN");
    printer.state = "PAPER_LOW";
    expect(await transport.status()).toBe("PAPER_LOW");
  });

  it("a printer that never answers status is UNKNOWN, not stuck", async () => {
    printer.state = "SILENT";
    const transport = new NetworkTransport("127.0.0.1", printer.port, { replyTimeoutMs: 150 });
    const started = Date.now();
    expect(await transport.status()).toBe("UNKNOWN");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("nothing listening is OFFLINE for status and an error for print", async () => {
    const port = printer.port;
    await printer.stop();
    printer = new FakePrinter();
    await printer.start();
    const transport = new NetworkTransport("127.0.0.1", port, { connectTimeoutMs: 300 });
    expect(await transport.status()).toBe("OFFLINE");
    await expect(transport.print(new Uint8Array([1, 2, 3]))).rejects.toThrow(/Printer not reachable/);
  });

  it("describes itself", () => {
    expect(new NetworkTransport("192.168.1.50", 9100).describe()).toBe("192.168.1.50:9100");
  });
});
