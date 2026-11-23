import type { MonoImage } from "./escpos";

/** Printable width in dots at 203 dpi: 72 mm on 80 mm rolls, 48 mm on 58 mm rolls. */
export const DOTS: Record<58 | 80, number> = { 80: 576, 58: 384 };

export type PixelImage = {
  width: number;
  height: number;
  /** 4 bytes per pixel. Electron's NativeImage.toBitmap() is BGRA. */
  data: Uint8Array;
  order: "bgra" | "rgba";
};

type Options = { threshold?: number; trimBottom?: boolean; marginRows?: number };

/**
 * Black-and-white conversion with a plain threshold: tickets are text and lines, which stay sharper
 * than with dithering. Transparent pixels count as paper.
 */
export function toMonochrome(image: PixelImage, options: Options = {}): MonoImage {
  const threshold = options.threshold ?? 160;
  const widthBytes = Math.ceil(image.width / 8);
  let bits = new Uint8Array(widthBytes * image.height);
  const [r, g, b] = image.order === "bgra" ? [2, 1, 0] : [0, 1, 2];
  let lastInked = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const alpha = image.data[i + 3] / 255;
      const lum = 0.299 * image.data[i + r] + 0.587 * image.data[i + g] + 0.114 * image.data[i + b];
      const onPaper = 255 - alpha * (255 - lum);
      if (onPaper < threshold) {
        bits[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
        lastInked = y;
      }
    }
  }
  let height = image.height;
  if (options.trimBottom) {
    height = Math.min(image.height, lastInked + 1 + (options.marginRows ?? 24));
    bits = bits.slice(0, widthBytes * height);
  }
  return { widthBytes, height, bits };
}
