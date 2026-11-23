#!/usr/bin/env node
/**
 * A pretend network thermal printer for testing without hardware (any OS, no dependencies).
 *
 *   node scripts/virtual-printer.mjs [--port 9100] [--host 127.0.0.1] [--out ./virtual-tickets] [--no-open]
 *
 * In Qwicoo Print choose "Network printer", IP 127.0.0.1, port 9100. Every ticket is saved as the
 * raw ESC/POS bytes (.bin) and as a PNG of exactly what the paper would show, and the PNG opens.
 * Keys: r ready · p paper out · l paper low · c cover open · o offline · q quit.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(opt("port", 9100));
const HOST = opt("host", "127.0.0.1");
const OUT = path.resolve(opt("out", "virtual-tickets"));
const OPEN = !args.includes("--no-open");

let state = "READY";
let warnedHttp = false;
let count = 0;
fs.mkdirSync(OUT, { recursive: true });

// DLE EOT n replies (n = 1 printer, 2 offline cause, 4 paper sensor), same bits as a real Xprinter.
const OK = 0x12;
function reply(n) {
  const i = [1, 2, 4].indexOf(n);
  if (i < 0) return OK;
  if (state === "PAPER_OUT") return [OK | 0x08, OK | 0x20, OK | 0x60][i];
  if (state === "COVER_OPEN") return [OK | 0x08, OK | 0x04, OK][i];
  if (state === "PAPER_LOW") return [OK, OK, OK | 0x0c][i];
  return OK;
}

// ---- ESC/POS raster (GS v 0 bands) → grayscale PNG
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function rasterToPng(data) {
  const rows = [];
  let widthBytes = 0;
  let cuts = 0;
  for (let i = 0; i < data.length - 1; ) {
    if (data[i] === 0x1d && data[i + 1] === 0x56) cuts++;
    if (data[i] === 0x1d && data[i + 1] === 0x76 && data[i + 2] === 0x30 && i + 8 <= data.length) {
      const wb = data[i + 4] | (data[i + 5] << 8);
      const h = data[i + 6] | (data[i + 7] << 8);
      widthBytes = wb;
      const start = i + 8;
      for (let r = 0; r < h; r++) rows.push(data.subarray(start + r * wb, start + (r + 1) * wb));
      i = start + h * wb;
    } else i++;
  }
  if (!rows.length) return null;
  const w = widthBytes * 8;
  const raw = Buffer.alloc((w + 1) * rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (row[x >> 3] >> (7 - (x & 7))) & 1 ? 0 : 255;
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(rows.length, 4);
  ihdr[8] = 8; // bit depth; colour type 0 = grayscale
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return { png, w, h: rows.length, cuts };
}

function save(bytes) {
  count++;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(OUT, `${String(count).padStart(3, "0")}-${stamp}`);
  fs.writeFileSync(`${base}.bin`, bytes);
  const decoded = rasterToPng(bytes);
  if (!decoded) {
    console.log(`⚠️  #${count}: BLANK ticket: ${bytes.length} bytes and no image (saved ${base}.bin)`);
    return;
  }
  fs.writeFileSync(`${base}.png`, decoded.png);
  const mm = Math.round((decoded.h / 8) * 10) / 10;
  console.log(`🧾 #${count}: ${decoded.w}×${decoded.h} dots (~${mm} mm of paper), ${decoded.cuts ? "cut" : "NO CUT"} → ${base}.png`);
  if (OPEN && process.platform === "darwin") execFile("open", [`${base}.png`], () => undefined);
  if (OPEN && process.platform === "win32") execFile("cmd", ["/c", "start", "", `${base}.png`], () => undefined);
}

const server = net.createServer((socket) => {
  if (state === "OFFLINE") return socket.destroy();
  const chunks = [];
  socket.on("data", (data) => {
    let rest = data;
    while (rest.length) {
      const at = rest.indexOf(Buffer.from([0x10, 0x04]));
      if (at === -1 || at + 2 >= rest.length) {
        chunks.push(rest);
        break;
      }
      if (at > 0) chunks.push(rest.subarray(0, at));
      socket.write(Buffer.from([reply(rest[at + 2])]));
      rest = rest.subarray(at + 3);
    }
  });
  socket.on("end", () => {
    const bytes = Buffer.concat(chunks);
    // Other apps on the computer sometimes probe port 9100 over HTTP; a real printer would print it as text.
    if (/^(GET|HEAD|POST|OPTIONS|PUT) /.test(bytes.subarray(0, 8).toString("latin1"))) {
      if (!warnedHttp) console.log("   (ignoring HTTP probes on this port from another app; a real printer would print them as junk)");
      warnedHttp = true;
      return socket.end();
    }
    if (bytes.length > 2) {
      if (state === "PAPER_OUT" || state === "COVER_OPEN") console.log(`⚠️  got ${bytes.length} bytes while ${state}: a real printer would not print this`);
      else save(bytes);
    }
    socket.end();
  });
  socket.on("error", () => undefined);
});

server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `Port ${PORT} is busy. Try --port 9101.` : error.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`🖨  Virtual thermal printer on ${HOST}:${PORT}. Tickets → ${OUT}`);
  console.log("   In Qwicoo Print: Network printer, IP 127.0.0.1, port " + PORT);
  console.log("   Keys: r ready · p paper out · l paper low · c cover open · o offline · q quit");
  console.log(`   State: ${state}`);
});

if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  const keys = { r: "READY", p: "PAPER_OUT", l: "PAPER_LOW", c: "COVER_OPEN", o: "OFFLINE" };
  process.stdin.on("keypress", (_s, key) => {
    if (key?.name === "q" || (key?.ctrl && key?.name === "c")) process.exit(0);
    const next = keys[key?.name];
    if (next) {
      state = next;
      console.log(`   State: ${state}`);
    }
  });
}
