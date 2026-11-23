import { HttpBridgeApi, pairDevice } from "../core/api";
import type { PrinterStatus } from "../core/escpos";
import { BridgeLoop, type BridgeState } from "../core/loop";
import type { KitchenTicket } from "../core/ticket";
import type { PrinterTransport } from "../core/transport";
import type { ConfigStore, PrinterConfig } from "./config";
import type { Log } from "./log";
import { ticketToBytes } from "./render";
import { NetworkTransport } from "./transports/network";
import { WindowsSpoolerTransport } from "./transports/windows-spooler";

const POLL_MS = 3000;
const STATUS_MS = 10_000;

export type AppState = {
  paired: boolean;
  branchName: string | null;
  printer: PrinterConfig | null;
  printerLabel: string | null;
  locale: "en" | "ar";
  version: string;
  loop: BridgeState | null;
};

export function transportFor(printer: PrinterConfig): PrinterTransport {
  return printer.type === "network" ? new NetworkTransport(printer.host, printer.port) : new WindowsSpoolerTransport(printer.name);
}

function testTicket(locale: "en" | "ar"): KitchenTicket {
  return {
    order_id: "00000000-test-print",
    order_type: "DINE_IN",
    table_number: locale === "ar" ? "تجربة" : "TEST",
    placed_at: new Date().toISOString(),
    lines: [
      {
        quantity: 1,
        name: locale === "ar" ? "تذكرة تجريبية · برجر بالجبنة" : "Test ticket · Cheese burger",
        modifiers: [locale === "ar" ? "بدون بصل" : "No onion"],
        note: null,
        station: locale === "ar" ? "فحص الطابعة" : "Printer check",
      },
    ],
    flags: [],
  };
}

/** Owns the print loop, its timers and the printer connection. Rebuilt when pairing or printer changes. */
export class PrintService {
  private loop: BridgeLoop | null = null;
  private timers: NodeJS.Timeout[] = [];
  private lastPhase: string | null = null;

  constructor(
    private readonly config: ConfigStore,
    private readonly log: Log,
    private readonly version: string,
    private readonly onChange: (state: AppState) => void,
  ) {}

  state(): AppState {
    const c = this.config.value;
    return {
      paired: Boolean(c.device && this.config.token()),
      branchName: c.device?.branchName ?? null,
      printer: c.printer ?? null,
      printerLabel: c.printer ? transportFor(c.printer).describe() : null,
      locale: c.locale,
      version: this.version,
      loop: this.loop?.current ?? null,
    };
  }

  get idle(): boolean {
    return !this.loop || this.loop.idle;
  }

  private emit(): void {
    this.onChange(this.state());
  }

  async start(takeOver = false): Promise<void> {
    this.stop();
    const c = this.config.value;
    const token = this.config.token();
    if (!c.device || !token || !c.printer) {
      this.emit();
      return;
    }
    const transport = transportFor(c.printer);
    const api = new HttpBridgeApi(c.apiBase, token);
    this.log.info(`starting: device ${c.device.deviceId}, printer ${transport.describe()}`);
    this.loop = new BridgeLoop({
      api,
      deviceId: c.device.deviceId,
      appVersion: this.version,
      printTicket: async (job, width) => {
        const bytes = await ticketToBytes(job.ticket, this.config.value.locale, width);
        await transport.print(bytes);
        this.log.info(`printed ticket ${job.job_id} (order ${job.ticket.order_id.slice(0, 8)})`);
      },
      printerStatus: () => transport.status(),
      onState: (s) => {
        if (s.phase !== this.lastPhase) {
          this.log.info(`phase ${this.lastPhase ?? "-"} -> ${s.phase}${s.lastError ? ` (${s.lastError})` : ""}`);
          this.lastPhase = s.phase;
        }
        if (s.width !== this.config.value.device?.width) this.config.setWidth(s.width);
        this.emit();
      },
    });
    await this.loop.start(takeOver);
    void this.loop.tick();
    void this.loop.reportStatus();
    this.timers.push(setInterval(() => void this.loop?.tick(), POLL_MS));
    this.timers.push(setInterval(() => void this.loop?.reportStatus(), STATUS_MS));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.loop?.stop();
    this.loop = null;
  }

  async pair(code: string, name: string): Promise<void> {
    const session = await pairDevice(this.config.value.apiBase, code.trim(), name.trim() || "Kitchen PC");
    this.config.setDevice(session);
    this.log.info(`paired as device ${session.deviceId} for ${session.branchName}`);
    await this.start();
  }

  forgetPairing(): void {
    this.stop();
    this.config.clearDevice();
    this.log.info("pairing removed on this PC");
    this.emit();
  }

  async checkPrinter(printer: PrinterConfig): Promise<PrinterStatus> {
    return transportFor(printer).status();
  }

  async setPrinter(printer: PrinterConfig): Promise<void> {
    this.config.setPrinter(printer);
    this.log.info(`printer set to ${transportFor(printer).describe()}`);
    await this.start();
  }

  async testPrint(printer?: PrinterConfig): Promise<void> {
    const target = printer ?? this.config.value.printer;
    if (!target) throw new Error("NO_PRINTER");
    const width = this.config.value.device?.width ?? 80;
    const bytes = await ticketToBytes(testTicket(this.config.value.locale), this.config.value.locale, width);
    await transportFor(target).print(bytes);
    this.log.info(`test print sent to ${transportFor(target).describe()}`);
  }

  async takeOver(): Promise<void> {
    await this.start(true);
  }

  setLocale(locale: "en" | "ar"): void {
    this.config.setLocale(locale);
    this.emit();
  }

  diagnostics(): string {
    const s = this.state();
    return [
      `Qwicoo Print ${this.version}`,
      `Paired: ${s.paired ? `yes (${s.branchName})` : "no"}`,
      `Device: ${this.config.value.device?.deviceId ?? "-"}`,
      `Printer: ${s.printerLabel ?? "-"}`,
      `Phase: ${s.loop?.phase ?? "-"}  Printer status: ${s.loop?.printerStatus ?? "-"}  Printed: ${s.loop?.printedCount ?? 0}`,
      `Last error: ${s.loop?.lastError ?? "-"}`,
      `API: ${this.config.value.apiBase}`,
      `OS: ${process.platform} ${process.getSystemVersion?.() ?? ""}`,
      "",
      "Recent log:",
      this.log.tail(80),
    ].join("\n");
  }
}
