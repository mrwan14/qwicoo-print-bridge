import { contextBridge, ipcRenderer } from "electron";

/** The only things the window can ask the app to do. No Node access in the page. */
contextBridge.exposeInMainWorld("qwicoo", {
  state: () => ipcRenderer.invoke("state"),
  pair: (code: string, name: string) => ipcRenderer.invoke("pair", code, name),
  usbPrinters: () => ipcRenderer.invoke("usb-printers"),
  checkPrinter: (printer: unknown) => ipcRenderer.invoke("check-printer", printer),
  setPrinter: (printer: unknown) => ipcRenderer.invoke("set-printer", printer),
  testPrint: (printer?: unknown) => ipcRenderer.invoke("test-print", printer),
  takeOver: () => ipcRenderer.invoke("take-over"),
  forgetPairing: () => ipcRenderer.invoke("forget-pairing"),
  copyDiagnostics: () => ipcRenderer.invoke("copy-diagnostics"),
  setLocale: (locale: string) => ipcRenderer.invoke("set-locale", locale),
  onState: (listener: (state: unknown) => void) => {
    ipcRenderer.on("state", (_event, state) => listener(state));
  },
});
