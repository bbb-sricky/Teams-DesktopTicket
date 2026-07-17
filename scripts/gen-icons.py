#!/usr/bin/env python3
"""Generate the Teams app icons (appPackage/color.png, appPackage/outline.png).

Run before packaging the Teams app:

    python3 scripts/gen-icons.py

Uses only the Python standard library (no Pillow required).
"""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "appPackage")
BLUE = (0x2A, 0x6D, 0xF4, 255)


def write_png(path, w, h, rgba_fn):
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            raw.extend(rgba_fn(x, y, w, h))

    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def color_px(x, y, w, h):
    # Blue square with a white "ticket" bar in the centre.
    if h * 0.42 < y < h * 0.58 and w * 0.22 < x < w * 0.78:
        return bytes((255, 255, 255, 255))
    return bytes(BLUE)


def outline_px(x, y, w, h):
    # Transparent background, white ticket glyph (outline + bar).
    border = 3
    inside = border <= x < w - border and border <= y < h - border
    edge = inside and not (border + 2 <= x < w - border - 2 and border + 2 <= y < h - border - 2)
    bar = h * 0.44 < y < h * 0.56 and border + 3 < x < w - border - 3
    if edge or bar:
        return bytes((255, 255, 255, 255))
    return bytes((255, 255, 255, 0))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    write_png(os.path.join(OUT_DIR, "color.png"), 192, 192, color_px)
    write_png(os.path.join(OUT_DIR, "outline.png"), 32, 32, outline_px)
    print("Wrote appPackage/color.png (192x192) and appPackage/outline.png (32x32)")


if __name__ == "__main__":
    main()
