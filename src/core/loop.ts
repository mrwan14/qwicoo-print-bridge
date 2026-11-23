import type { BridgeApi, QueueJob } from "./api";
import type { PrinterStatus } from "./escpos";

/**
 * The print bridge engine (ported from the web printer page's PrinterLoop, plus printer status).
 *
 * claim → poll → for each ticket: check printer → print → check printer → ack.
 * A ticket is acked only when the printer took it and reports no problem afterwards. If the paper
 * runs out mid-ticket the ticket is printed again once fixed: a duplicate beats a lost order.
 */

export type BridgePhase = "starting" | "running" | "blocked" | "lost" | "off" | "offline" | "printer-error" | "unpaired";

export type BridgeState = {
  phase: BridgePhase;
  width: 58 | 80;
  printerStatus: PrinterStatus;
  printedCount: number;
  waiting: number;
  lastPrinted: { orderId: string; at: number } | null;
  lastError: string | null;
};

type Deps = {
  api: BridgeApi;
  deviceId: string;
  appVersion: string;
  /** Renders the ticket and sends it to the printer; resolves when the printer accepted it. */
  printTicket: (job: QueueJob, width: 58 | 80) => Promise<void>;
  printerStatus: () => Promise<PrinterStatus>;
  onState: (state: BridgeState) => void;
  now?: () => number;
};

const HOLD: ReadonlySet<PrinterStatus> = new Set(["PAPER_OUT", "COVER_OPEN", "OFFLINE"]);

function phaseFor(code: string): BridgePhase {
  if (code === "PRINTER_DEVICE_UNPAIRED") return "unpaired";
  if (code === "PRINTER_LEASE_LOST") return "lost";
  if (code === "PRINTER_ALREADY_ACTIVE") return "blocked";
  if (code === "NOT_PRINTER_MODE") return "off";
  return "offline";
}

export class BridgeLoop {
  private readonly deps: Deps;
  private state: BridgeState = {
    phase: "starting",
    width: 80,
    printerStatus: "UNKNOWN",
    printedCount: 0,
    waiting: 0,
    lastPrinted: null,
    lastError: null,
  };
  private busy: Promise<void> | null = null;
  private claimed = false;
  private stopped = false;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  get current(): BridgeState {
    return this.state;
  }

  /** True when nothing is waiting or printing: a safe moment to install an update. */
  get idle(): boolean {
    return !this.busy && this.state.waiting === 0;
  }

  private set(patch: Partial<BridgeState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.onState(this.state);
  }

  async start(takeOver = false): Promise<void> {
    this.stopped = false;
    this.set({ phase: "starting", lastError: null });
    try {
      const result = await this.deps.api.claim(this.deps.deviceId, takeOver);
      if (!result.ok) {
        this.set({ phase: phaseFor(result.code), lastError: result.code });
        return;
      }
      this.claimed = true;
      this.set({ phase: "running", width: result.width });
    } catch (error) {
      this.set({ phase: "offline", lastError: message(error) });
    }
  }

  stop(): void {
    this.stopped = true;
  }

  tick(): Promise<void> {
    if (this.busy) return this.busy;
    this.busy = this.pass().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  /** Every ~10s: tell Qwicoo how the printer is doing (drives the paper-out / offline alerts). */
  async reportStatus(): Promise<void> {
    if (this.stopped || !this.claimed || this.state.phase === "unpaired" || this.state.phase === "lost") return;
    const status = await this.safeStatus();
    this.set({ printerStatus: status });
    try {
      const result = await this.deps.api.status(this.deps.deviceId, status, this.deps.appVersion);
      if (!result.ok && (result.code === "PRINTER_DEVICE_UNPAIRED" || result.code === "PRINTER_LEASE_LOST")) {
        this.set({ phase: phaseFor(result.code), lastError: result.code });
      }
    } catch {
      // The next poll reports the network problem.
    }
  }

  private async safeStatus(): Promise<PrinterStatus> {
    try {
      return await this.deps.printerStatus();
    } catch {
      return "UNKNOWN";
    }
  }

  private async pass(): Promise<void> {
    if (this.stopped || this.state.phase === "unpaired" || this.state.phase === "lost" || this.state.phase === "off") return;
    if (!this.claimed) {
      // The first claim never got through (no internet at startup): keep trying it.
      if (this.state.phase === "offline") await this.start();
      return;
    }
    let jobs: QueueJob[];
    try {
      const result = await this.deps.api.queue(this.deps.deviceId);
      if (!result.ok) {
        this.set({ phase: phaseFor(result.code), lastError: result.code });
        return;
      }
      jobs = result.jobs;
    } catch (error) {
      this.set({ phase: "offline", lastError: message(error) });
      return;
    }
    this.set({ waiting: jobs.length });
    if (jobs.length === 0) {
      if (this.state.phase !== "running") this.set({ phase: "running", lastError: null });
      return;
    }

    for (const [index, job] of jobs.entries()) {
      if (this.stopped) return;
      const before = await this.safeStatus();
      this.set({ printerStatus: before });
      if (HOLD.has(before)) return; // tickets wait on the server; the status report raises the alert

      try {
        await this.deps.printTicket(job, this.state.width);
      } catch (error) {
        this.set({ phase: "printer-error", lastError: message(error), printerStatus: "OFFLINE" });
        return;
      }
      const after = await this.safeStatus();
      this.set({ printerStatus: after });
      if (HOLD.has(after)) return; // print again when fixed rather than ack a ticket that may be lost

      try {
        const ack = await this.deps.api.ack(this.deps.deviceId, job.job_id);
        if (!ack.ok) {
          this.set({ phase: phaseFor(ack.code), lastError: ack.code });
          return;
        }
      } catch (error) {
        this.set({ phase: "offline", lastError: message(error) });
        return;
      }
      this.set({
        phase: "running",
        lastError: null,
        printedCount: this.state.printedCount + 1,
        lastPrinted: { orderId: job.ticket.order_id, at: (this.deps.now ?? Date.now)() },
        waiting: jobs.length - index - 1,
      });
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
