import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BridgeApi, QueueJob } from "../src/core/api";
import { ticketBytes } from "../src/core/escpos";
import { BridgeLoop } from "../src/core/loop";
import { NetworkTransport } from "../src/main/transports/network";
import { FakePrinter } from "./fake-printer";

/** Real loop + real network transport + pretend printer; only the Qwicoo API and the ticket image are stubbed. */
let printer: FakePrinter;
beforeEach(async () => {
  printer = new FakePrinter();
  await printer.start();
});
afterEach(async () => printer.stop());

function job(id: string): QueueJob {
  return { job_id: id, kind: "ORDER", late: false, ticket: { order_id: `o-${id}`, order_type: "DINE_IN", placed_at: "2026-11-24T10:00:00Z", lines: [], flags: [] } };
}

describe("ticket to paper", () => {
  it("prints queued tickets on the printer, holds them while out of paper, and acks once printed", async () => {
    let queue = [job("a")];
    const acked: string[] = [];
    const reported: string[] = [];
    const api: BridgeApi = {
      claim: async () => ({ ok: true, width: 80 }),
      queue: async () => ({ ok: true, jobs: queue }),
      ack: async (_d, id) => {
        acked.push(id);
        queue = queue.filter((j) => j.job_id !== id);
        return { ok: true };
      },
      status: async (_d, s) => (reported.push(s), { ok: true }),
    };
    const transport = new NetworkTransport("127.0.0.1", printer.port, { replyTimeoutMs: 300 });
    const image = { widthBytes: 72, height: 40, bits: new Uint8Array(72 * 40).fill(0xaa) };
    const loop = new BridgeLoop({
      api,
      deviceId: "d1",
      appVersion: "test",
      printTicket: async () => transport.print(ticketBytes(image)),
      printerStatus: () => transport.status(),
      onState: () => undefined,
    });

    printer.state = "PAPER_OUT";
    await loop.start();
    await loop.tick();
    await loop.reportStatus();
    expect(acked).toEqual([]);
    expect(reported).toEqual(["PAPER_OUT"]);
    expect(printer.printed().length).toBe(0);

    printer.state = "READY";
    await loop.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(acked).toEqual(["a"]);
    const sent = printer.printed();
    expect(sent.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(sent.length).toBe(ticketBytes(image).length);
  });
});
