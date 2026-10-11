"""Generate small, code-drawn extension icons without external image assets."""
import math, struct, zlib
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'public' / 'icons'
root.mkdir(parents=True, exist_ok=True)
def chunk(t, data):
    return struct.pack('!I', len(data)) + t + data + struct.pack('!I', zlib.crc32(t + data) & 0xffffffff)
for size in (16, 48, 128):
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = (x + .5) / size, (y + .5) / size
            inside = .05 < px < .95 and .05 < py < .95 and math.hypot(max(.20-px,0,px-.80), max(.20-py,0,py-.80)) < .15
            color = (36, 94, 79, 255) if inside else (0,0,0,0)
            lines = abs(px-.5)<.022 and .3<py<.52 or abs(py-.52)<.022 and .28<px<.72 or min(abs(px-.28),abs(px-.72))<.022 and .52<py<.68
            circles = any(math.hypot(px-cx,py-cy)<.083 for cx,cy in ((.5,.27),(.28,.72),(.72,.72)))
            if inside and (lines or circles): color = (241,248,240,255)
            row.extend(color)
        rows.append(b'\x00'+row)
    png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
    (root / f'icon{size}.png').write_bytes(png)
