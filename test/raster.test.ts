import { describe, expect, it } from "vitest";

import { DOTS, toMonochrome } from "../src/core/raster";

function image(width: number, height: number, paint: (x: number, y: number) => number, order: "rgba" | "bgra" = "bgra") {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data, order };
}

describe("monochrome raster", () => {
  it("printable widths in dots", () => {
    expect(DOTS[80]).toBe(576);
    expect(DOTS[58]).toBe(384);
  });

  it("packs dark pixels as 1 bits, most significant first", () => {
    const img = image(8, 1, (x) => (x < 3 ? 0 : 255));
    const out = toMonochrome(img);
    expect(out.widthBytes).toBe(1);
    expect([...out.bits]).toEqual([0b11100000]);
  });

  it("pads the last byte of a row", () => {
    const out = toMonochrome(image(10, 2, () => 0));
    expect(out.widthBytes).toBe(2);
    expect([...out.bits]).toEqual([0xff, 0xc0, 0xff, 0xc0]);
  });

  it("transparent pixels print as paper", () => {
    const img = image(8, 1, () => 0);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 0;
    expect([...toMonochrome(img).bits]).toEqual([0]);
  });

  it("uses the luminance of coloured pixels with a threshold", () => {
    const img = { width: 2, height: 1, order: "rgba" as const, data: new Uint8Array([255, 0, 0, 255, 255, 255, 0, 255]) };
    // pure red is dark enough to print, yellow is not
    expect([...toMonochrome(img).bits]).toEqual([0b10000000]);
  });

  it("trims blank paper at the bottom but keeps a small margin", () => {
    const img = image(8, 100, (_x, y) => (y < 10 ? 0 : 255));
    const out = toMonochrome(img, { trimBottom: true, marginRows: 4 });
    expect(out.height).toBe(14);
  });
});
