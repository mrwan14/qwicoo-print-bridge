"""Dev check: decode a ticket's ESC/POS raster (GS v 0 bands) back into a PNG, i.e. what the printer prints."""
import struct, sys, zlib

data = open(sys.argv[1], "rb").read()
rows, width_bytes, i = [], None, 0
while i < len(data) - 8:
    if data[i] == 0x1D and data[i + 1] == 0x76 and data[i + 2] == 0x30:
        wb = data[i + 4] | data[i + 5] << 8
        h = data[i + 6] | data[i + 7] << 8
        width_bytes = wb
        start = i + 8
        for r in range(h):
            rows.append(data[start + r * wb : start + (r + 1) * wb])
        i = start + h * wb
    else:
        i += 1
w, h = width_bytes * 8, len(rows)
raw = b"".join(b"\x00" + bytes(255 - (255 if (row[x >> 3] >> (7 - (x & 7))) & 1 else 0) for x in range(w)) for row in rows)
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
open(sys.argv[2], "wb").write(png)
print(f"{w}x{h} dots, {len(data)} bytes")
