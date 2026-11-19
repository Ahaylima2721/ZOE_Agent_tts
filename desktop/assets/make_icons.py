"""Gera os ícones PNG da Zoe (orbe roxa) sem dependências: python3 make_icons.py"""
import math, struct, zlib, pathlib

def orb_png(size: int) -> bytes:
    rows = []
    c, r = (size - 1) / 2, size / 2 - 0.5
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            d = math.hypot(x - c, y - c) / r
            if d > 1:
                row += bytes(4); continue
            # gradiente radial roxo do portfólio + reflexo no canto superior esquerdo
            stops = [(0, (0xC9, 0xA7, 0xFF)), (.38, (0x8B, 0x5C, 0xF6)), (.72, (0x5B, 0x21, 0xB6)), (1, (0x2A, 0x0E, 0x5E))]
            for (a, ca), (b, cb) in zip(stops, stops[1:]):
                if a <= d <= b:
                    t = (d - a) / (b - a); col = [ca[i] + (cb[i] - ca[i]) * t for i in range(3)]; break
            hx, hy = x - size * .32, y - size * .26
            h = max(0, 1 - math.hypot(hx, hy) / (size * .2)) ** 2
            col = [v + (255 - v) * h * .9 for v in col]
            alpha = 255 if d < .96 else int(255 * (1 - d) / .04)
            row += bytes([int(col[0]), int(col[1]), int(col[2]), alpha])
        rows.append(bytes(row))
    # olhos
    img = [bytearray(r) for r in rows]
    ew, eh = max(1, round(size * .1)), max(2, round(size * .17))
    for ex in (round(size * .37), round(size * .57)):
        for yy in range(round(size * .44), round(size * .44) + eh):
            for xx in range(ex, ex + ew):
                i = 1 + xx * 4
                img[yy][i:i + 4] = bytes([0xF7, 0xF3, 0xFF, 255])
    raw = b"".join(bytes(r) for r in img)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

here = pathlib.Path(__file__).parent
(here / "tray.png").write_bytes(orb_png(32))
(here / "zoe.png").write_bytes(orb_png(256))
print("ícones gerados")
