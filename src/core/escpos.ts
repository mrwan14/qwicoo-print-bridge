/**
 * ESC/POS bytes for thermal printers (Xprinter, Epson-compatible). No Electron or Node APIs here,
 * so the same core can move to a React Native Android app later.
 *
 * Tickets are printed as one raster image (GS v 0): the ticket is drawn by a browser engine first,
 * so Arabic and English print correctly on printers that have no Arabic font.
 */

export type PrinterStatus = "READY" | "PAPER_LOW" | "PAPER_OUT" | "COVER_OPEN" | "OFFLINE" | "UNKNOWN";

export type MonoImage = {
  /** Bytes per row (8 dots per byte, most significant bit first). */
  widthBytes: number;
  height: number;
  /** widthBytes * height bytes; a 1 bit prints a dot. */
  bits: Uint8Array;
};

export const INIT = Uint8Array.of(0x1b, 0x40); // ESC @
/** GS V 66 n: feed n lines past the cutter, then a partial cut (ignored by printers without a cutter). */
export const CUT = Uint8Array.of(0x1d, 0x56, 0x42, 0x03);
const FEED = Uint8Array.of(0x1b, 0x64, 0x03); // ESC d 3

/** DLE EOT n real-time status: 1 printer, 2 offline cause, 4 paper sensor. */
export const STATUS_QUERIES: readonly Uint8Array[] = [
  Uint8Array.of(0x10, 0x04, 0x01),
  Uint8Array.of(0x10, 0x04, 0x02),
  Uint8Array.of(0x10, 0x04, 0x04),
];

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** GS v 0 raster, split into bands of at most `bandRows` rows (small printer buffers choke on one huge image). */
export function rasterImage(image: MonoImage, bandRows = 256): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let top = 0; top < image.height; top += bandRows) {
    const rows = Math.min(bandRows, image.height - top);
    parts.push(
      Uint8Array.of(0x1d, 0x76, 0x30, 0x00, image.widthBytes & 0xff, image.widthBytes >> 8, rows & 0xff, rows >> 8),
      image.bits.subarray(top * image.widthBytes, (top + rows) * image.widthBytes),
    );
  }
  return concat(parts);
}

/** Everything the printer needs for one ticket. */
export function ticketBytes(image: MonoImage): Uint8Array {
  return concat([INIT, rasterImage(image), FEED, CUT]);
}

/** A status byte always has bit 1 and bit 4 set and bit 0 and bit 7 clear. */
function valid(byte: number | undefined): byte is number {
  return byte !== undefined && (byte & 0x93) === 0x12;
}

/** Turn the three DLE EOT replies (1, 2, 4) into one status. */
export function parseStatus(replies: readonly number[]): PrinterStatus {
  const [printer, cause, paper] = replies;
  if (!valid(printer) || !valid(cause) || !valid(paper)) return "UNKNOWN";
  if (paper & 0x60 || cause & 0x20) return "PAPER_OUT";
  if (cause & 0x04) return "COVER_OPEN";
  if (printer & 0x08) return "OFFLINE";
  if (paper & 0x0c) return "PAPER_LOW";
  return "READY";
}
