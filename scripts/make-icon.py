"""生成 1024×1024 的占位应用图标（纯标准库，不依赖 PIL）：靛蓝底 + 白色圆点。

用法: python3 scripts/make-icon.py out.png
"""
import struct
import sys
import zlib

N = 1024
BG = (47, 79, 168)
FG = (250, 248, 244)


def png(path: str) -> None:
    rows = []
    c, r = N / 2, N * 0.22
    for y in range(N):
        row = bytearray([0])
        for x in range(N):
            d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            # 边缘 1.5px 抗锯齿
            t = max(0.0, min(1.0, (r + 0.75 - d) / 1.5))
            row += bytes(int(BG[i] + (FG[i] - BG[i]) * t) for i in range(3)) + b"\xff"
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


if __name__ == "__main__":
    png(sys.argv[1])
