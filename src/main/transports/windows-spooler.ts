import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PrinterStatus } from "../../core/escpos";
import type { PrinterTransport } from "../../core/transport";

/** Runs a PowerShell script and returns its stdout. Injected in tests. */
export type Runner = (script: string) => Promise<string>;

type Deps = {
  run?: Runner;
  writeTemp?: (bytes: Uint8Array) => Promise<string>;
  removeTemp?: (file: string) => Promise<void>;
};

/** WQL string literal escaping: backslash before backslashes and quotes. */
export function wqlEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

/** Single-quoted PowerShell string: nothing inside is expanded, a quote is doubled. */
export function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export const runPowerShell: Runner = (script) =>
  new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim())),
    );
  });

/**
 * Raw bytes to a printer through the Windows spooler (winspool.drv with the RAW datatype), so the
 * driver passes ESC/POS through untouched. Works with the USB driver restaurants already installed,
 * and needs no native Node modules.
 */
const RAW_PRINT = (printer: string, file: string) => `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class QwicooRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr h, int level, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static string Send(string printer, string file) {
    byte[] bytes = System.IO.File.ReadAllBytes(file);
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "ERR:" + Marshal.GetLastWin32Error();
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Qwicoo kitchen ticket"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) return "ERR:" + Marshal.GetLastWin32Error();
      StartPagePrinter(h);
      int written;
      bool ok = WritePrinter(h, bytes, bytes.Length, out written);
      EndPagePrinter(h); EndDocPrinter(h);
      if (!ok || written != bytes.Length) return "ERR:" + Marshal.GetLastWin32Error();
      return "OK";
    } finally { ClosePrinter(h); }
  }
}
"@
[QwicooRaw]::Send(${psQuote(printer)}, ${psQuote(file)})
`;

/** Win32_Printer fields → status. DetectedErrorState: 3 low paper, 4 no paper, 7 door open, 9 offline. */
export function mapWin32Printer(info: { WorkOffline?: boolean; PrinterStatus?: number; DetectedErrorState?: number } | null): PrinterStatus {
  if (!info) return "OFFLINE";
  if (info.WorkOffline) return "OFFLINE";
  switch (info.DetectedErrorState) {
    case 4:
      return "PAPER_OUT";
    case 7:
      return "COVER_OPEN";
    case 9:
      return "OFFLINE";
    case 3:
      return "PAPER_LOW";
  }
  if (info.PrinterStatus === 3 || info.PrinterStatus === 4 || info.PrinterStatus === 5) return "READY";
  if (info.PrinterStatus === 7) return "OFFLINE";
  return "UNKNOWN";
}

export class WindowsSpoolerTransport implements PrinterTransport {
  private readonly run: Runner;
  private readonly writeTemp: (bytes: Uint8Array) => Promise<string>;
  private readonly removeTemp: (file: string) => Promise<void>;

  constructor(
    readonly printerName: string,
    deps: Deps = {},
  ) {
    this.run = deps.run ?? runPowerShell;
    this.writeTemp =
      deps.writeTemp ??
      (async (bytes) => {
        const file = path.join(os.tmpdir(), `qwicoo-${process.pid}-${Date.now()}.bin`);
        await fs.writeFile(file, bytes);
        return file;
      });
    this.removeTemp = deps.removeTemp ?? ((file) => fs.rm(file, { force: true }));
  }

  static async list(run: Runner = runPowerShell): Promise<string[]> {
    const out = await run("Get-CimInstance Win32_Printer | Select-Object Name | ConvertTo-Json -Compress");
    if (!out) return [];
    const parsed = JSON.parse(out) as { Name: string } | { Name: string }[];
    return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => p.Name).filter(Boolean);
  }

  describe(): string {
    return `${this.printerName} (USB)`;
  }

  async print(bytes: Uint8Array): Promise<void> {
    const file = await this.writeTemp(bytes);
    try {
      const out = await this.run(RAW_PRINT(this.printerName, file));
      if (!out.trim().endsWith("OK")) throw new Error(`Windows could not print to ${this.printerName} (${out.trim() || "no reply"})`);
    } finally {
      await this.removeTemp(file).catch(() => undefined);
    }
  }

  async status(): Promise<PrinterStatus> {
    try {
      const out = await this.run(
        `Get-CimInstance Win32_Printer -Filter ${psQuote(`Name='${wqlEscape(this.printerName)}'`)} | ` +
          "Select-Object WorkOffline, PrinterStatus, DetectedErrorState | ConvertTo-Json -Compress",
      );
      if (!out) return "OFFLINE";
      return mapWin32Printer(JSON.parse(out));
    } catch {
      return "UNKNOWN";
    }
  }
}
