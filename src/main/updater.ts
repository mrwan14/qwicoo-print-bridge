import { autoUpdater } from "electron-updater";

import type { Log } from "./log";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Daily update check from GitHub Releases. A downloaded update installs only at a quiet moment
 * (no tickets waiting or printing), and keeps config.json, so pairing and printer survive.
 */
export function startUpdater(log: Log, isIdle: () => boolean): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m: unknown) => log.info(`update: ${String(m)}`), warn: (m: unknown) => log.warn(`update: ${String(m)}`), error: (m: unknown) => log.error(`update: ${String(m)}`), debug: () => undefined } as never;

  let ready = false;
  autoUpdater.on("update-downloaded", (info) => {
    ready = true;
    log.info(`update ${info.version} downloaded; installing when idle`);
  });
  autoUpdater.on("error", (error) => log.warn(`update check failed: ${error.message}`));

  const check = () => void autoUpdater.checkForUpdates().catch((error: Error) => log.warn(`update check failed: ${error.message}`));
  setTimeout(check, 60_000);
  setInterval(check, DAY);
  setInterval(() => {
    if (ready && isIdle()) {
      log.info("installing update now (idle)");
      autoUpdater.quitAndInstall(true, true);
    }
  }, 60_000);
}
