"""生成「纸与墨」风格的中文标题字体子集（思源宋体 / Noto Serif SC Bold）。

整套字体几十 MB 没法随 App 打包，只留：常用 3500 字（GB2312 一级）+ 界面代码和内容包里出现过的全部汉字。
不在子集里的字（比如 AI 回复里的生僻字）自动回落到系统字体，不会显示成方框。

用法（要 fonttools 和 brotli：pip install fonttools brotli）:
  curl -sSfL -o NotoSerifSC.ttf "https://github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf"
  python scripts/subset-title-font.py NotoSerifSC.ttf
产物: apps/web/src/styles/fonts/noto-serif-sc-700-subset.woff2
"""
import glob
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "web" / "src" / "styles" / "fonts" / "noto-serif-sc-700-subset.woff2"


def chars() -> str:
    s = set("0123456789，。、：；？！（）《》“”‘’—…·「」『』～")
    for hi in range(0xB0, 0xD8):  # GB2312 一级常用字
        for lo in range(0xA1, 0xFF):
            try:
                s.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    files = glob.glob(str(ROOT / "apps/web/src/**/*.ts*"), recursive=True) + glob.glob(str(ROOT / "content/**/*.json"), recursive=True)
    for f in files:
        s.update(ch for ch in Path(f).read_text(encoding="utf-8") if 0x3000 <= ord(ch) <= 0x9FFF or 0xFF00 <= ord(ch) <= 0xFFEF)
    return "".join(sorted(s))


def main() -> None:
    src = sys.argv[1]
    with tempfile.TemporaryDirectory() as d:
        bold = Path(d) / "bold.ttf"
        text = Path(d) / "chars.txt"
        text.write_text(chars(), encoding="utf-8")
        subprocess.run([sys.executable, "-m", "fontTools.varLib.instancer", src, "wght=700", "-o", str(bold), "-q"], check=True)
        subprocess.run([sys.executable, "-m", "fontTools.subset", str(bold), f"--text-file={text}", "--flavor=woff2", "--layout-features=*", f"--output-file={OUT}"], check=True)
    print(OUT.name, round(OUT.stat().st_size / 1e3), "KB")


if __name__ == "__main__":
    main()
