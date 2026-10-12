"""从品牌原图生成所有图标：assets/brand/logo-src.png（白底，上面是圆角方块图标、下面是“日日说 sayday”字标）

产物（都在 assets/brand/ 下）:
  icon-1024.png           透明圆角的主图标（安卓构建用它跑 `tauri icon`）
  icon-512/192/64/32.png  网页、门户用（透明圆角）
  icon-180.png            iOS 主屏图标：满铺不透明（iOS 自己切圆角，透明处会变黑）
  icon-maskable-512.png   PWA 可裁切图标：底色满铺，图标缩到安全区里
  favicon.ico             16/32/48
  og.png                  1200x630 分享卡片（整个 logo 含字标）
  android/mipmap-*/ic_launcher_foreground.png  安卓自适应图标前景层（只显示中间约 2/3，所以图标缩到 64%，四周用图标边缘颜色向外扩散补满）

抠图：从四角把白底连通区域找出来当背景；边缘像素是“图标色和白色混合”，按蓝色通道算透明度并去掉白色成分，
所以缩小后边缘没有白边。原图里图标约 570px 见方，1024 是放大来的，以后有更高清的原图换上重跑即可。
用法: .venv/bin/python scripts/make-brand-icons.py   （需要 Pillow + numpy + scipy）
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
B = ROOT / "assets" / "brand"
SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def cut_icon(src: np.ndarray) -> Image.Image:
    """src: 白底 RGB。返回透明背景的正方形 RGBA 图标（原始分辨率）。"""
    rgb = src.astype(float)
    # 图标在上半部分：按“明显不是白色”的像素找方块的外框（字标在下面，单独排除）
    col = (rgb[..., 0] > 200) & (rgb[..., 2] < 140) & (rgb[..., 1] > 100)
    rows = np.where(col.any(axis=1))[0]
    # 方块和字标之间有一段空白：取第一段连续的行
    gap = np.where(np.diff(rows) > 8)[0]
    top, bot = rows[0], rows[gap[0]] if len(gap) else rows[-1]
    xs = np.where(col[top:bot + 1].any(axis=0))[0]
    left, right = xs[0], xs[-1]
    side = max(right - left, bot - top) + 1
    cx, cy = (left + right) / 2, (top + bot) / 2
    pad = 6
    x0, y0 = int(round(cx - side / 2)) - pad, int(round(cy - side / 2)) - pad
    n = side + 2 * pad
    crop = rgb[y0:y0 + n, x0:x0 + n]

    # 白底：从四条边往里，把连着的近白像素都标成背景
    white = crop.min(axis=2) > 240
    bg = np.zeros(white.shape, bool)
    q = deque()
    for i in range(n):
        for p in ((0, i), (n - 1, i), (i, 0), (i, n - 1)):
            if white[p] and not bg[p]:
                bg[p] = True
                q.append(p)
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < n and 0 <= xx < n and white[yy, xx] and not bg[yy, xx]:
                bg[yy, xx] = True
                q.append((yy, xx))

    # 边缘带：背景旁边 3 像素以内的前景像素按蓝色通道估透明度（图标边缘蓝色约 20，白底 255）
    alpha = np.where(bg, 0.0, 1.0)
    near = np.zeros_like(bg)
    for d in range(1, 4):
        for dy, dx in ((d, 0), (-d, 0), (0, d), (0, -d)):
            near |= np.roll(np.roll(bg, dy, 0), dx, 1)
    band = near & ~bg
    edge_b = np.median(crop[..., 2][~bg & ~near & (crop.min(axis=2) < 200)])
    a = np.clip((255 - crop[..., 2]) / max(1.0, 255 - edge_b), 0, 1)
    alpha[band] = a[band]
    # 也处理被判成背景、但其实带一点黄的抗锯齿像素
    soft = bg & near & (crop[..., 2] < 250)
    alpha[soft] = a[soft]
    # 去掉白色成分：c = (pix - (1 - a) * 255) / a
    out = crop.copy()
    m = (alpha > 0) & (alpha < 1)
    for c in range(3):
        ch = out[..., c]
        ch[m] = np.clip((ch[m] - (1 - alpha[m]) * 255) / alpha[m], 0, 255)
    rgba = np.dstack([out, alpha * 255]).round().astype(np.uint8)
    return Image.fromarray(rgba)


def full_bleed(ic: Image.Image, L: int, scale: float) -> Image.Image:
    """图标缩到 scale 居中，四周用图标边缘自己的颜色向外扩散补满（不透明正方形）。

    扩散用“归一化模糊”：分别模糊 预乘颜色 和 透明度，相除得到只由图标像素决定的颜色场；
    大半径的先铺底，小半径的按置信度叠上去，越靠近图标越贴近边缘真实颜色，接缝处颜色一致。"""
    from PIL import ImageFilter
    from scipy.ndimage import gaussian_filter
    s = round(L * scale)
    off = (L - s) // 2
    icon = ic.resize((s, s), Image.LANCZOS)
    # 颜色来源只取图标最外圈一带（离边缘 2%~8%）的底色，避开白色气泡和书，也避开边缘那圈高光
    A = np.asarray(icon.getchannel("A")) > 250
    from scipy.ndimage import binary_erosion
    k = lambda f: max(1, round(s * f))
    inner = binary_erosion(A, iterations=k(0.02))
    core = binary_erosion(A, iterations=k(0.08))
    rgb_ic = np.asarray(icon)[..., :3]
    ring = inner & ~core & (rgb_ic.min(axis=2) < 200)
    solid = icon.copy()
    solid.putalpha(Image.fromarray((ring * 255).astype(np.uint8)))
    src = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    src.paste(solid, (off, off))
    a = np.asarray(src).astype(float) / 255
    pm = a[..., :3] * a[..., 3:4]
    out = np.zeros((L, L, 3))
    filled = np.zeros((L, L))
    for r in (L / 2, L / 6, L / 16, L / 48):
        def blur(x: np.ndarray) -> np.ndarray:
            return gaussian_filter(x, r / 2, mode="nearest")
        wa = blur(a[..., 3])
        col = np.stack([blur(pm[..., c]) for c in range(3)], -1) / np.maximum(wa, 1e-6)[..., None]
        conf = np.clip(wa * 4, 0, 1)[..., None] if filled.any() else 1.0
        out = out * (1 - conf) + col * conf
        filled = np.maximum(filled, wa)
    layer = Image.fromarray(np.dstack([np.clip(out * 255, 0, 255), np.full((L, L), 255.0)]).astype(np.uint8))
    # 贴图标时边缘往里收约 1.5% 并羽化：原图边缘那圈高光 / 抗锯齿被底色盖掉，看不出接缝
    edge = binary_erosion(A, iterations=k(0.015))
    soft = Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(max(1, s * 0.006)))
    icon.putalpha(soft)
    layer.alpha_composite(icon, (off, off))
    return layer


def main() -> None:
    src = np.asarray(Image.open(B / "logo-src.png").convert("RGB"))
    ic = cut_icon(src)
    big = ic.resize((1024, 1024), Image.LANCZOS)
    big.save(B / "icon-1024.png", optimize=True)
    for s in (512, 192, 64, 32):
        ic.resize((s, s), Image.LANCZOS).save(B / f"icon-{s}.png", optimize=True)
    full_bleed(big, 180, 1.0).convert("RGB").save(B / "icon-180.png", optimize=True)
    full_bleed(big, 512, 0.78).convert("RGB").save(B / "icon-maskable-512.png", optimize=True)
    ic.resize((256, 256), Image.LANCZOS).save(B / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    fg = full_bleed(big, 1024, 0.64)
    for d, n in SIZES.items():
        out = B / "android" / f"mipmap-{d}" / "ic_launcher_foreground.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        fg.resize((n, n), Image.LANCZOS).save(out, optimize=True)
    # 分享卡片：整个 logo（含字标）放在白底中间
    logo = Image.open(B / "logo-src.png").convert("RGB")
    g = np.asarray(logo).min(axis=2) < 235
    ys, xs = np.where(g)
    box = logo.crop((xs.min() - 20, ys.min() - 20, xs.max() + 20, ys.max() + 20))
    h = 540
    box = box.resize((round(box.width * h / box.height), h), Image.LANCZOS)
    og = Image.new("RGB", (1200, 630), tuple(int(v) for v in np.asarray(logo)[2, 2]))
    og.paste(box, ((1200 - box.width) // 2, (630 - h) // 2))
    og.save(B / "og.png", optimize=True)
    for p in sorted(B.rglob("*.png")) + [B / "favicon.ico"]:
        print(p.relative_to(ROOT), Image.open(p).size)


if __name__ == "__main__":
    main()
