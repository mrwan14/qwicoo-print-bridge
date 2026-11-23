import { describe, expect, it } from "vitest";

import { CUT, INIT, STATUS_QUERIES, parseStatus, rasterImage, ticketBytes } from "../src/core/escpos";

describe("ESC/POS commands", () => {
  it("initialises and cuts with feed", () => {
    expect([...INIT]).toEqual([0x1b, 0x40]);
    expect([...CUT]).toEqual([0x1d, 0x56, 0x42, 0x03]);
  });

  it("encodes a raster image with GS v 0 and its size", () => {
    // 16 dots wide (2 bytes), 2 rows
    const bits = new Uint8Array([0xff, 0x00, 0x0f, 0xf0]);
    const bytes = rasterImage({ widthBytes: 2, height: 2, bits });
    expect([...bytes.slice(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 0x02, 0x00, 0x02, 0x00]);
    expect([...bytes.slice(8)]).toEqual([0xff, 0x00, 0x0f, 0xf0]);
  });

  it("splits tall images into bands so printers with small buffers keep up", () => {
    const height = 600;
    const bits = new Uint8Array(72 * height);
    const bytes = rasterImage({ widthBytes: 72, height, bits }, 256);
    const headers = [];
    for (let i = 0; i < bytes.length - 3; i++) {
      if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) headers.push(bytes[i + 6] + bytes[i + 7] * 256);
    }
    expect(headers).toEqual([256, 256, 88]);
    expect(bytes.length).toBe(3 * 8 + 72 * height);
  });

  it("builds a whole ticket: init, image, feed and cut", () => {
    const bytes = ticketBytes({ widthBytes: 1, height: 1, bits: new Uint8Array([0x80]) });
    expect([...bytes.slice(0, 2)]).toEqual([...INIT]);
    expect([...bytes.slice(-4)]).toEqual([...CUT]);
  });

  it("asks for printer, offline-cause and paper status", () => {
    expect(STATUS_QUERIES.map((q) => [...q])).toEqual([
      [0x10, 0x04, 0x01],
      [0x10, 0x04, 0x02],
      [0x10, 0x04, 0x04],
    ]);
  });
});

describe("status replies", () => {
  const OK = 0x12; // fixed bits 1 and 4 set, everything else clear

  it("all clear is READY", () => {
    expect(parseStatus([OK, OK, OK])).toBe("READY");
  });

  it("paper end is PAPER_OUT, even when the printer also says offline", () => {
    expect(parseStatus([OK | 0x08, OK | 0x20, OK | 0x60])).toBe("PAPER_OUT");
  });

  it("cover open", () => {
    expect(parseStatus([OK | 0x08, OK | 0x04, OK])).toBe("COVER_OPEN");
  });

  it("paper near end is PAPER_LOW", () => {
    expect(parseStatus([OK, OK, OK | 0x0c])).toBe("PAPER_LOW");
  });

  it("offline for another reason", () => {
    expect(parseStatus([OK | 0x08, OK, OK])).toBe("OFFLINE");
  });

  it("garbage or missing replies are UNKNOWN", () => {
    expect(parseStatus([0xff, OK, OK])).toBe("UNKNOWN");
    expect(parseStatus([OK])).toBe("UNKNOWN");
    expect(parseStatus([])).toBe("UNKNOWN");
  });
});
