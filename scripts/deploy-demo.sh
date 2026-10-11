#!/usr/bin/env bash
# 发布 sayday.ivyea.com：门户（site/）+ 演示页（spikes/m0/web + 运行时依赖 + 模型）。
# 用法: scripts/deploy-demo.sh /var/www/sayday.ivyea.com
set -euo pipefail
DEST=${1:?目标目录}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
M0=$ROOT/spikes/m0
NM=$M0/node_modules
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/web/models" "$STAGE/web/samples" \
  "$STAGE/node_modules/onnxruntime-web/dist" \
  "$STAGE/node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm"
for f in index.html app.js db-worker.js demo.html demo.js infer-worker.js tts-worker.js gop.mjs calib.mjs sw.js; do cat "$M0/web/$f" > "$STAGE/web/$f"; done
# 门户（公开）：site/ 原样放到站点根；品牌图标
cat "$ROOT/site/index.html" > "$STAGE/index.html"
mkdir -p "$STAGE/assets/audio"
for f in site.css site.js; do cat "$ROOT/site/assets/$f" > "$STAGE/assets/$f"; done
for f in "$ROOT"/site/assets/audio/*; do cat "$f" > "$STAGE/assets/audio/$(basename "$f")"; done
mkdir -p "$STAGE/brand"
for s in 32 64 180 192 512; do cat "$ROOT/assets/brand/icon-$s.png" > "$STAGE/brand/icon-$s.png"; done
cat "$ROOT/assets/brand/favicon.ico" > "$STAGE/favicon.ico"
# 示范读音：预生成音频 + 自定义句子用的 Kokoro（模型由 spikes/tts 准备到 .cache/models/kokoro）
TTS=$ROOT/.cache/models/kokoro/onnx-community/Kokoro-82M-v1.0-ONNX
TNM=$ROOT/spikes/tts/node_modules
mkdir -p "$STAGE/web/tts/samples" "$STAGE/web/tts/onnx-community/Kokoro-82M-v1.0-ONNX/onnx" "$STAGE/web/tts/onnx-community/Kokoro-82M-v1.0-ONNX/voices" \
  "$STAGE/node_modules/kokoro-js/dist" "$STAGE/node_modules/kokoro-js/ort"
for f in "$M0"/web/tts/samples/*; do cat "$f" > "$STAGE/web/tts/samples/$(basename "$f")"; done
for f in config.json tokenizer.json tokenizer_config.json onnx/model_quantized.onnx voices/af_heart.bin voices/bf_emma.bin; do cat "$TTS/$f" > "$STAGE/web/tts/onnx-community/Kokoro-82M-v1.0-ONNX/$f"; done
cat "$TNM/kokoro-js/dist/kokoro.web.js" > "$STAGE/node_modules/kokoro-js/dist/kokoro.web.js"
for f in ort-wasm-simd-threaded.jsep.mjs ort-wasm-simd-threaded.jsep.wasm; do cat "$TNM/onnxruntime-web/dist/$f" > "$STAGE/node_modules/kokoro-js/ort/$f"; done
for f in calib.json cmudict.min.json cmudict.LICENSE meta.json u0.f32 u0.ref.f32 u1.f32 u1.ref.f32 u2.f32 u2.ref.f32; do cat "$M0/web/samples/$f" > "$STAGE/web/samples/$f"; done
for f in phone_ctc.int8.onnx charsiu_vocab.json; do cat "$ROOT/.cache/models/$f" > "$STAGE/web/models/$f"; done
for f in ort.wasm.min.mjs ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do cat "$NM/onnxruntime-web/dist/$f" > "$STAGE/node_modules/onnxruntime-web/dist/$f"; done
for f in sqlite3-bundler-friendly.mjs sqlite3.wasm sqlite3-opfs-async-proxy.js; do cat "$NM/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/$f" > "$STAGE/node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/$f"; done

# 先放到同级临时目录，再整体替换，避免发布中途页面读到半套文件
NEW="$DEST.new.$$"
rm -rf "$NEW"
cp -r "$STAGE" "$NEW"
# download/（安装包 + version.json）由 scripts/sync-release.sh 管，替换时原样保留（cp -a 保留软链接）
if [ -d "$DEST/download" ]; then cp -a "$DEST/download" "$NEW/download"; fi
if [ -d "$DEST" ]; then rm -rf "$DEST.old"; mv "$DEST" "$DEST.old"; fi
mv "$NEW" "$DEST"
rm -rf "$DEST.old"
chmod -R a+rX "$DEST"
du -sh "$DEST"
