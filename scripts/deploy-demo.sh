#!/usr/bin/env bash
# 发布 sayday.ivyea.com：门户（site/）+ 正式版网页（apps/web → /app/）+ 演示页（spikes/m0/web → /web/）。
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
mkdir -p "$STAGE/assets/fonts" "$STAGE/assets/shots"
for d in fonts shots; do for f in "$ROOT"/site/assets/$d/*; do cat "$f" > "$STAGE/assets/$d/$(basename "$f")"; done; done
mkdir -p "$STAGE/brand"
for s in 32 64 180 192 512; do cat "$ROOT/assets/brand/icon-$s.png" > "$STAGE/brand/icon-$s.png"; done
cat "$ROOT/assets/brand/favicon.ico" > "$STAGE/favicon.ico"
cat "$ROOT/assets/brand/og.png" > "$STAGE/brand/og.png"
# 示范读音：预生成音频 + 自定义句子用的 Kokoro（模型由 spikes/tts 准备到 .cache/models/kokoro）
TTS=$ROOT/.cache/models/kokoro/onnx-community/Kokoro-82M-v1.0-ONNX
TNM=$ROOT/content/audio/node_modules
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

# 正式版网页（apps/web）→ /app/；音素模型与演示页共用（软链接），不存两份
( cd "$ROOT/apps/web" && [ -d node_modules ] || npm ci --no-audit --no-fund )
NATIVE=0 bash "$ROOT/scripts/prepare-web-assets.sh" >/dev/null
( cd "$ROOT/apps/web" && npx tsc --noEmit && npx vite build --logLevel warn )
cp -r "$ROOT/apps/web/dist" "$STAGE/app"
rm -f "$STAGE/app/models/phone_ctc.int8.onnx" && ln -s ../../web/models/phone_ctc.int8.onnx "$STAGE/app/models/phone_ctc.int8.onnx"

# 离线语音识别模型（scripts/fetch-asr-model.sh 下载到 .cache/models/asr）→ /asr/moonshine-base-q8/（公开，App 跨域取）
ASR=$ROOT/.cache/models/asr/moonshine-base
mkdir -p "$STAGE/asr/moonshine-base-q8"
cat "$ASR/onnx/encoder_model_quantized.onnx" > "$STAGE/asr/moonshine-base-q8/encoder.onnx"
cat "$ASR/onnx/decoder_model_merged_quantized.onnx" > "$STAGE/asr/moonshine-base-q8/decoder.onnx"
cat "$ASR/vocab.json" > "$STAGE/asr/moonshine-base-q8/vocab.json"

# 先放到同级临时目录，再整体替换，避免发布中途页面读到半套文件
NEW="$DEST.new.$$"
rm -rf "$NEW"
cp -r "$STAGE" "$NEW"
# download/（安装包 + version.json）由 scripts/sync-release.sh 管，替换时原样挪过去（含软链接）
if [ -d "$DEST/download" ]; then mv "$DEST/download" "$NEW/download"; fi
# audio/（示范音频包，scripts/sync-audio.sh 管）体积大：直接挪过去，不复制
if [ -d "$DEST/audio" ]; then mv "$DEST/audio" "$NEW/audio"; fi
if [ -d "$DEST" ]; then rm -rf "$DEST.old"; mv "$DEST" "$DEST.old"; fi
mv "$NEW" "$DEST"
rm -rf "$DEST.old"
chmod -R a+rX "$DEST"
du -sh "$DEST"
