import type { PrinterStatus } from "./escpos";

/** A way to reach one printer. Platform code (Windows, Android) implements it; the core only uses it. */
export interface PrinterTransport {
  /** For logs and the settings screen, e.g. "192.168.1.50:9100" or "XP-80C (USB)". */
  describe(): string;
  /** Resolves once the printer (or the Windows spooler) accepted every byte. */
  print(bytes: Uint8Array): Promise<void>;
  /** Best effort; UNKNOWN when the printer can't say. */
  status(): Promise<PrinterStatus>;
}
