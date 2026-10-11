#!/usr/bin/env bash
# 组装 App 前端产物 apps/native/dist：App 页面 + 网页版共用的评分模块与样本。
# 依赖 .cache/models/charsiu_vocab.json（CI 里由下载步骤生成）。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=$ROOT/spikes/m0/web
OUT=$ROOT/apps/native/dist
rm -rf "$OUT"
mkdir -p "$OUT/samples"
cp "$ROOT"/apps/native/web/* "$OUT/"
cp "$SRC/gop.mjs" "$SRC/calib.mjs" "$OUT/"
for f in calib.json cmudict.min.json cmudict.LICENSE meta.json u0.f32 u0.ref.f32 u1.f32 u1.ref.f32 u2.f32 u2.ref.f32; do cp "$SRC/samples/$f" "$OUT/samples/"; done
cp "$ROOT/.cache/models/charsiu_vocab.json" "$OUT/samples/"
du -sh "$OUT"
