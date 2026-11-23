import path from "node:path";

import { BrowserWindow, Menu, Tray, app, clipboard, ipcMain, nativeImage, safeStorage, shell } from "electron";

import { ConfigStore, type PrinterConfig, type Sealer } from "./config";
import { Log } from "./log";
import { PrintService, listUsbPrinters, type AppState } from "./service";
import { validCupsName } from "./transports/cups";
import { startUpdater } from "./updater";

// Tickets are drawn in an offscreen window; with GPU compositing its capturePage comes back empty
// (seen on macOS), which would print blank tickets. Software rendering is plenty for this app.
app.disableHardwareAcceleration();

// Test runs can keep their pairing and logs apart from the installed app.
if (process.env.QWICOO_USER_DATA) app.setPath("userData", process.env.QWICOO_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const sealer: Sealer = {
  available: () => safeStorage.isEncryptionAvailable(),
  seal: (text) => safeStorage.encryptString(text).toString("base64"),
  open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, "base64")),
};

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let service: PrintService;
let log: Log;

function validPrinter(value: unknown): PrinterConfig {
  const p = value as Partial<PrinterConfig> & { host?: string; port?: number; name?: string };
  if (p?.type === "network" && typeof p.host === "string" && /^[A-Za-z0-9.-]{1,253}$/.test(p.host.trim())) {
    const port = Number(p.port ?? 9100);
    if (Number.isInteger(port) && port > 0 && port < 65536) return { type: "network", host: p.host.trim(), port };
  }
  if (p?.type === "usb" && typeof p.name === "string" && p.name.trim().length > 0 && p.name.length < 256) {
    if (process.platform !== "win32" && !validCupsName(p.name)) throw new Error("INVALID_PRINTER");
    return { type: "usb", name: p.name };
  }
  throw new Error("INVALID_PRINTER");
}

function trayIcon() {
  const file = path.join(app.getAppPath(), "assets", "tray.png");
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 });
}

function showWindow(): void {
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 420,
    title: "Qwicoo Print",
    backgroundColor: "#F5F1EC",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.loadFile(path.join(__dirname, "..", "renderer", "app.html"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Closing the window keeps printing in the tray.
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window?.hide();
    }
  });
}

function updateTray(state: AppState): void {
  if (!tray) return;
  const phase = state.loop?.phase;
  const status = state.loop?.printerStatus;
  const label = !state.paired
    ? "Not set up"
    : !state.printer
      ? "Choose a printer"
      : phase === "running" && (status === "READY" || status === "PAPER_LOW" || status === "UNKNOWN")
        ? "Printing"
        : `Needs attention (${status && status !== "READY" ? status : phase})`;
  tray.setToolTip(`Qwicoo Print · ${label}`);
}

function broadcast(state: AppState): void {
  updateTray(state);
  window?.webContents.send("state", state);
}

app.on("second-instance", () => showWindow());
// macOS: clicking the Dock icon reopens the window.
app.on("activate", () => showWindow());

app.whenReady().then(async () => {
  log = new Log(path.join(app.getPath("userData"), "logs"));
  const config = new ConfigStore(app.getPath("userData"), sealer);
  service = new PrintService(config, log, app.getVersion(), broadcast);
  log.info(`Qwicoo Print ${app.getVersion()} starting`);

  // Start with the computer, hidden in the tray (Windows passes --hidden; macOS opens as hidden).
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args: ["--hidden"] });

  ipcMain.handle("state", () => service.state());
  ipcMain.handle("pair", (_e, code: string, name: string) => service.pair(String(code), String(name)));
  ipcMain.handle("usb-printers", () => listUsbPrinters());
  ipcMain.handle("check-printer", (_e, printer: unknown) => service.checkPrinter(validPrinter(printer)));
  ipcMain.handle("set-printer", (_e, printer: unknown) => service.setPrinter(validPrinter(printer)));
  ipcMain.handle("test-print", (_e, printer?: unknown) => service.testPrint(printer ? validPrinter(printer) : undefined));
  ipcMain.handle("take-over", () => service.takeOver());
  ipcMain.handle("forget-pairing", () => service.forgetPairing());
  ipcMain.handle("copy-diagnostics", () => clipboard.writeText(service.diagnostics()));
  ipcMain.handle("set-locale", (_e, locale: string) => service.setLocale(locale === "en" ? "en" : "ar"));

  tray = new Tray(trayIcon());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Qwicoo Print", click: () => showWindow() },
      { label: "Copy diagnostics", click: () => clipboard.writeText(service.diagnostics()) },
      { type: "separator" },
      {
        label: "Quit (stops printing)",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => showWindow());

  await service.start();
  const s = service.state();
  const hidden = process.argv.includes("--hidden") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAsHidden);
  if (!hidden || !s.paired || !s.printer) showWindow();
  // macOS auto-update needs a signed app; the Mac build is for testing until we have an Apple certificate.
  if (app.isPackaged && process.platform === "win32") startUpdater(log, () => service.idle);
});

app.on("before-quit", () => {
  quitting = true;
  service?.stop();
  log?.info("quitting");
});

// Keep running in the tray when the window closes.
app.on("window-all-closed", () => undefined);
