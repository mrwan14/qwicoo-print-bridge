import fs from "node:fs";
import path from "node:path";

/** Small rotating log in the app's data folder (1 MB, 3 files). Never logs the device token. */
export class Log {
  private readonly file: string;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "qwicoo-print.log");
  }

  get path(): string {
    return this.file;
  }

  write(level: "info" | "warn" | "error", message: string): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redact(message)}\n`;
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 1_000_000) this.rotate();
      fs.appendFileSync(this.file, line);
    } catch {
      // Logging must never stop printing.
    }
  }

  info(message: string): void {
    this.write("info", message);
  }
  warn(message: string): void {
    this.write("warn", message);
  }
  error(message: string): void {
    this.write("error", message);
  }

  tail(lines = 200): string {
    try {
      return fs.readFileSync(this.file, "utf8").split("\n").slice(-lines).join("\n");
    } catch {
      return "";
    }
  }

  private rotate(): void {
    for (let i = 2; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${this.file}.${i + 1}`);
    }
    fs.renameSync(this.file, `${this.file}.1`);
  }
}

export function redact(text: string): string {
  return text.replace(/qpd_[A-Za-z0-9_-]+/g, "qpd_***");
}
