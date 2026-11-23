import { describe, expect, it } from "vitest";

import type { BridgeApi, QueueJob } from "../src/core/api";
import type { PrinterStatus } from "../src/core/escpos";
import { BridgeLoop, type BridgeState } from "../src/core/loop";

function job(id: string): QueueJob {
  return { job_id: id, kind: "ORDER", late: false, ticket: { order_id: `o-${id}`, order_type: "DINE_IN", table_number: "4", placed_at: "2026-11-24T10:00:00Z", lines: [], flags: [] } };
}

function setup(opts: { status?: PrinterStatus[]; failPrint?: number } = {}) {
  let queue: QueueJob[] = [];
  const calls: string[] = [];
  const statuses = [...(opts.status ?? [])];
  let current: PrinterStatus = statuses[0] ?? "READY";
  let failPrint = opts.failPrint ?? 0;
  const api: BridgeApi = {
    claim: async (_d, takeOver) => (calls.push(`claim:${takeOver}`), { ok: true, width: 80 }),
    queue: async () => (calls.push("queue"), { ok: true, jobs: queue }),
    ack: async (_d, id) => {
      calls.push(`ack:${id}`);
      queue = queue.filter((j) => j.job_id !== id);
      return { ok: true };
    },
    status: async (_d, s) => (calls.push(`status:${s}`), { ok: true }),
  };
  const printed: string[] = [];
  const states: BridgeState[] = [];
  const loop = new BridgeLoop({
    api,
    deviceId: "d1",
    appVersion: "0.1.0",
    printTicket: async (j) => {
      if (failPrint > 0) {
        failPrint--;
        throw new Error("Printer not reachable at 1.2.3.4:9100");
      }
      printed.push(j.job_id);
    },
    printerStatus: async () => {
      if (statuses.length) current = statuses.shift() as PrinterStatus;
      return current;
    },
    onState: (s) => states.push(s),
  });
  return { loop, calls, printed, setQueue: (j: QueueJob[]) => (queue = j), last: () => states.at(-1), setStatus: (s: PrinterStatus) => (current = s) };
}

describe("bridge print loop", () => {
  it("prints and acks waiting tickets in order", async () => {
    const t = setup();
    t.setQueue([job("a"), job("b")]);
    await t.loop.start();
    await t.loop.tick();
    expect(t.printed).toEqual(["a", "b"]);
    expect(t.calls.filter((c) => c.startsWith("ack"))).toEqual(["ack:a", "ack:b"]);
    expect(t.last()?.phase).toBe("running");
  });

  it("holds tickets while the printer is out of paper, prints them when fixed", async () => {
    const t = setup();
    t.setStatus("PAPER_OUT");
    t.setQueue([job("a")]);
    await t.loop.start();
    await t.loop.tick();
    expect(t.printed).toEqual([]);
    expect(t.calls.some((c) => c.startsWith("ack"))).toBe(false);
    expect(t.last()?.printerStatus).toBe("PAPER_OUT");
    t.setStatus("READY");
    await t.loop.tick();
    expect(t.printed).toEqual(["a"]);
    expect(t.calls).toContain("ack:a");
  });

  it("paper running out during a ticket prints it again rather than losing it", async () => {
    const t = setup({ status: ["READY", "PAPER_OUT"] });
    t.setQueue([job("a")]);
    await t.loop.start();
    await t.loop.tick();
    expect(t.calls).not.toContain("ack:a");
    t.setStatus("READY");
    await t.loop.tick();
    expect(t.printed).toEqual(["a", "a"]);
    expect(t.calls).toContain("ack:a");
  });

  it("paper low still prints", async () => {
    const t = setup();
    t.setStatus("PAPER_LOW");
    t.setQueue([job("a")]);
    await t.loop.start();
    await t.loop.tick();
    expect(t.printed).toEqual(["a"]);
  });

  it("printers that can't report status (UNKNOWN) still print", async () => {
    const t = setup();
    t.setStatus("UNKNOWN");
    t.setQueue([job("a")]);
    await t.loop.start();
    await t.loop.tick();
    expect(t.printed).toEqual(["a"]);
  });

  it("an unreachable printer keeps the ticket and reports OFFLINE", async () => {
    const t = setup({ failPrint: 1 });
    t.setQueue([job("a")]);
    await t.loop.start();
    await t.loop.tick();
    expect(t.calls).not.toContain("ack:a");
    expect(t.last()?.phase).toBe("printer-error");
    await t.loop.tick();
    expect(t.printed).toEqual(["a"]);
    expect(t.calls).toContain("ack:a");
  });

  it("reports printer status with the app version", async () => {
    const t = setup();
    t.setStatus("COVER_OPEN");
    await t.loop.start();
    await t.loop.reportStatus();
    expect(t.calls).toContain("status:COVER_OPEN");
  });

  it("unpaired stops everything", async () => {
    const t = setup();
    await t.loop.start();
    (t.loop as unknown as { deps: { api: BridgeApi } }).deps.api.queue = async () => ({ ok: false, code: "PRINTER_DEVICE_UNPAIRED" });
    await t.loop.tick();
    expect(t.last()?.phase).toBe("unpaired");
    t.setQueue([job("z")]);
    await t.loop.tick();
    expect(t.printed).toEqual([]);
  });

  it("lease lost and take over", async () => {
    const t = setup();
    await t.loop.start();
    (t.loop as unknown as { deps: { api: BridgeApi } }).deps.api.queue = async () => ({ ok: false, code: "PRINTER_LEASE_LOST" });
    await t.loop.tick();
    expect(t.last()?.phase).toBe("lost");
  });
});

describe("startup without internet", () => {
  it("keeps retrying the claim until the network is back", async () => {
    const t = setup();
    const api = (t.loop as unknown as { deps: { api: BridgeApi } }).deps.api;
    const realClaim = api.claim;
    let down = true;
    api.claim = async (d, x) => {
      if (down) throw new TypeError("fetch failed");
      return realClaim(d, x);
    };
    t.setQueue([job("a")]);
    await t.loop.start();
    expect(t.last()?.phase).toBe("offline");
    await t.loop.tick();
    expect(t.printed).toEqual([]);
    down = false;
    await t.loop.tick();
    await t.loop.tick();
    expect(t.printed).toEqual(["a"]);
  });
});
