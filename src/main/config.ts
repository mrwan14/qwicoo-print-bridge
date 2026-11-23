import fs from "node:fs";
import path from "node:path";

export type PrinterConfig = { type: "network"; host: string; port: number } | { type: "usb"; name: string };

export type BridgeConfig = {
  apiBase: string;
  locale: "en" | "ar";
  device?: { deviceId: string; branchName: string; width: 58 | 80; tokenSealed: string; sealed: boolean };
  printer?: PrinterConfig;
};

export const DEFAULT_API = process.env.QWICOO_API_URL ?? "https://api.qwicoo.com/api/v1";

/** Encrypts the device token with the OS (DPAPI on Windows). Injected so tests don't need Electron. */
export type Sealer = { available(): boolean; seal(text: string): string; open(sealed: string): string };

export class ConfigStore {
  private readonly file: string;
  private data: BridgeConfig;

  constructor(
    dir: string,
    private readonly sealer: Sealer,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "config.json");
    this.data = this.read();
  }

  private read(): BridgeConfig {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<BridgeConfig>;
      return { apiBase: parsed.apiBase || DEFAULT_API, locale: parsed.locale === "en" ? "en" : "ar", device: parsed.device, printer: parsed.printer };
    } catch {
      return { apiBase: DEFAULT_API, locale: "ar" };
    }
  }

  private write(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get value(): BridgeConfig {
    return this.data;
  }

  token(): string | null {
    const device = this.data.device;
    if (!device) return null;
    try {
      return device.sealed ? this.sealer.open(device.tokenSealed) : Buffer.from(device.tokenSealed, "base64").toString("utf8");
    } catch {
      return null;
    }
  }

  setDevice(session: { deviceId: string; token: string; branchName: string; width: 58 | 80 }): void {
    const sealed = this.sealer.available();
    this.data.device = {
      deviceId: session.deviceId,
      branchName: session.branchName,
      width: session.width,
      sealed,
      tokenSealed: sealed ? this.sealer.seal(session.token) : Buffer.from(session.token, "utf8").toString("base64"),
    };
    this.write();
  }

  clearDevice(): void {
    delete this.data.device;
    this.write();
  }

  setPrinter(printer: PrinterConfig): void {
    this.data.printer = printer;
    this.write();
  }

  setLocale(locale: "en" | "ar"): void {
    this.data.locale = locale;
    this.write();
  }

  setWidth(width: 58 | 80): void {
    if (this.data.device) {
      this.data.device.width = width;
      this.write();
    }
  }
}
