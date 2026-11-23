import { BrowserWindow, type NativeImage } from "electron";

import { ticketBytes } from "../core/escpos";
import { TICKET_LABELS } from "../core/labels";
import { DOTS, toMonochrome } from "../core/raster";
import type { KitchenTicket } from "../core/ticket";
import { kitchenTicketHtml, type LocaleCode } from "../core/ticket-document";

/** CSS width of the ticket sheet at 96 px per inch (72 mm on 80 mm paper, 50 mm on 58 mm). */
const SHEET_CSS_PX: Record<58 | 80, number> = { 80: (72 / 25.4) * 96, 58: (50 / 25.4) * 96 };
const MAX_HEIGHT = 12000;

let window: BrowserWindow | null = null;
let queue: Promise<unknown> = Promise.resolve();

function renderer(): BrowserWindow {
  if (window && !window.isDestroyed()) return window;
  window = new BrowserWindow({
    show: false,
    width: DOTS[80],
    height: MAX_HEIGHT,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      // Tickets carry text typed by guests. It is escaped, and no script runs in this window anyway.
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setFrameRate(1);
  return window;
}

/**
 * capturePage returns device pixels: on a 125%/150%/200% scaled screen the image is wider than the
 * printer's dots. Scale it back to exactly one pixel per printer dot.
 */
export function atDotWidth(image: NativeImage, dots: number): NativeImage {
  const { width } = image.getSize();
  return width === dots ? image : image.resize({ width: dots, quality: "best" });
}

/** Draw a ticket at the printer's dot width and capture it as pixels. One ticket at a time. */
async function renderPixels(html: string, width: 58 | 80) {
  const win = renderer();
  const dots = DOTS[width];
  win.setContentSize(dots, MAX_HEIGHT);
  await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf-8").toString("base64")}`);
  win.webContents.setZoomFactor(dots / SHEET_CSS_PX[width]);
  // Give fonts (Arabic fallback) a frame to settle after the zoom.
  await new Promise((resolve) => setTimeout(resolve, 120));
  const captured = await win.webContents.capturePage({ x: 0, y: 0, width: dots, height: MAX_HEIGHT });
  const image = atDotWidth(captured, dots);
  const size = image.getSize();
  return { width: size.width, height: size.height, data: new Uint8Array(image.toBitmap()), order: "bgra" as const };
}

/** The ESC/POS bytes for one kitchen ticket. */
export function ticketToBytes(ticket: KitchenTicket, locale: LocaleCode, width: 58 | 80): Promise<Uint8Array> {
  const run = queue.then(async () => {
    const html = kitchenTicketHtml(ticket, locale, TICKET_LABELS[locale], width);
    const pixels = await renderPixels(html, width);
    return ticketBytes(toMonochrome(pixels, { trimBottom: true, marginRows: 16 }));
  });
  queue = run.catch(() => undefined);
  return run;
}

/** For the setup screen and the diagnostics page: the same image as a PNG. */
export async function ticketPreviewPng(ticket: KitchenTicket, locale: LocaleCode, width: 58 | 80): Promise<Buffer> {
  const html = kitchenTicketHtml(ticket, locale, TICKET_LABELS[locale], width);
  const win = renderer();
  const dots = DOTS[width];
  win.setContentSize(dots, MAX_HEIGHT);
  await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf-8").toString("base64")}`);
  win.webContents.setZoomFactor(dots / SHEET_CSS_PX[width]);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: dots, height: 1400 });
  return atDotWidth(image, dots).toPNG();
}
