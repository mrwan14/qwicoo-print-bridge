import { spawn } from "node:child_process";

import type { PrinterStatus } from "../../core/escpos";
import type { PrinterTransport } from "../../core/transport";

/** Runs a CUPS command (no shell) with optional stdin and returns stdout. Injected in tests. */
export type CupsRunner = (cmd: string, args: string[], input?: Uint8Array) => Promise<string>;

/** CUPS queue names: no spaces, "/" or "#"; we also refuse a leading "-" so it can't read as an option. */
export function validCupsName(name: string): boolean {
  return /^[A-Za-z0-9_.@+][A-Za-z0-9_.@+-]{0,126}$/.test(name);
}

export const runCups: CupsRunner = (cmd, args, input) =>
  new Promise((resolve, reject) => {
    // English output so status parsing doesn't depend on the Mac's language.
    const child = spawn(cmd, args, { env: { ...process.env, LANG: "C", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(Buffer.concat(err).toString("utf8").trim() || `${cmd} exited with ${code}`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ? Buffer.from(input) : undefined);
  });

/** `lpstat -l -p NAME` → status. Alerts are IPP printer-state-reasons. */
export function mapCupsStatus(text: string): PrinterStatus {
  const alerts = /Alerts:\s*(.*)/.exec(text)?.[1] ?? "";
  if (/media-empty|media-needed/.test(alerts)) return "PAPER_OUT";
  if (/cover-open|door-open/.test(alerts)) return "COVER_OPEN";
  if (/offline/.test(alerts)) return "OFFLINE";
  if (/^printer \S+ disabled/m.test(text)) return "OFFLINE";
  if (/media-low/.test(alerts)) return "PAPER_LOW";
  if (/^printer \S+ (is idle|now printing)/m.test(text)) return "READY";
  return "UNKNOWN";
}

/**
 * Raw bytes to a printer through CUPS (macOS), so the driver passes ESC/POS through untouched.
 * The printer must be added in System Settings → Printers & Scanners (any driver; "-o raw" bypasses it).
 */
export class CupsTransport implements PrinterTransport {
  private readonly run: CupsRunner;

  constructor(
    readonly printerName: string,
    deps: { run?: CupsRunner } = {},
  ) {
    if (!validCupsName(printerName)) throw new Error("INVALID_PRINTER");
    this.run = deps.run ?? runCups;
  }

  static async list(run: CupsRunner = runCups): Promise<string[]> {
    try {
      const out = await run("lpstat", ["-e"]);
      return out.split("\n").map((s) => s.trim()).filter(validCupsName);
    } catch {
      return []; // "No destinations added." exits non-zero
    }
  }

  describe(): string {
    return `${this.printerName} (USB)`;
  }

  async print(bytes: Uint8Array): Promise<void> {
    try {
      await this.run("lp", ["-d", this.printerName, "-o", "raw", "-t", "Qwicoo kitchen ticket"], bytes);
    } catch (error) {
      throw new Error(`macOS could not print to ${this.printerName} (${(error as Error).message})`);
    }
  }

  async status(): Promise<PrinterStatus> {
    try {
      return mapCupsStatus(await this.run("lpstat", ["-l", "-p", this.printerName]));
    } catch {
      return "OFFLINE";
    }
  }
}
