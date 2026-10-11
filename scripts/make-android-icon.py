"""安卓自适应图标前景层：assets/brand/icon-1024.png → assets/brand/android/mipmap-*/ic_launcher_foreground.png

自适应图标只显示前景层中间约 2/3，`tauri icon` 直接把整张图标铺满前景层，气泡和书的两侧会被裁掉。
这里把图标缩到 64% 居中，四周用按图标底色拟合出的渐变补满（图标边缘内收几像素，接缝不可见）。
用法: .venv/bin/python scripts/make-android-icon.py   （需要 Pillow + numpy）
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SCALE = 0.64
SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def basis(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return np.c_[np.ones(x.size), x.ravel(), y.ravel(), (x * y).ravel(), (x**2).ravel(), (y**2).ravel()]


def main() -> None:
    ic = Image.open(ROOT / "assets/brand/icon-1024.png").convert("RGBA")
    a = np.asarray(ic).astype(float)
    W = a.shape[0]
    ys, xs = np.mgrid[0:W, 0:W] / (W - 1)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    m = (al > 250) & (b > 220) & (r < 80) & (g < 200)  # 纯底色像素
    X = basis(xs[m], ys[m])
    coef = [np.linalg.lstsq(X, a[..., c][m], rcond=None)[0] for c in range(3)]

    alpha = ic.getchannel("A").point(lambda v: 255 if v > 250 else 0).filter(ImageFilter.MinFilter(21)).filter(ImageFilter.GaussianBlur(3))
    ic.putalpha(alpha)

    L = 1024
    s = round(L * SCALE)
    off = (L - s) // 2
    v, u = (np.mgrid[0:L, 0:L].astype(float) - off) / s
    F = basis(u, v)
    rgb = [np.clip(F @ coef[c], 0, 255).reshape(L, L) for c in range(3)]
    layer = Image.fromarray(np.stack(rgb + [np.full((L, L), 255.0)], -1).astype(np.uint8))
    layer.alpha_composite(ic.resize((s, s), Image.LANCZOS), (off, off))
    for d, n in SIZES.items():
        out = ROOT / f"assets/brand/android/mipmap-{d}/ic_launcher_foreground.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        layer.resize((n, n), Image.LANCZOS).save(out, optimize=True)
        print(out.relative_to(ROOT))


if __name__ == "__main__":
    main()
