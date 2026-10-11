#!/usr/bin/env bash
# 把 apps/web 运行时要的大文件放进 apps/web/public（不进仓库）：
#   content/   内容包（content/pack，由 content/build_content.py 生成）
#   speech/    评分校准、CMU 词典、音素表
#   models/    音素识别模型（.cache/models，NATIVE=1 时跳过：App 里走原生插件自带的模型）
#   ort/       onnxruntime-web 的 wasm
#   tts/       预置示范音频；网页版另带 Kokoro 语音模型 + kokoro-js（音频包里没有的句子在本机合成；NATIVE=1 不带）
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PUB=$ROOT/apps/web/public
NM=$ROOT/apps/web/node_modules
mkdir -p "$PUB/content" "$PUB/speech" "$PUB/ort"
for f in words.json sentences.json pseudo.json meta.json; do cat "$ROOT/content/pack/$f" > "$PUB/content/$f"; done
for f in calib.json cmudict.min.json cmudict.LICENSE; do cat "$ROOT/packages/speech/$f" > "$PUB/speech/$f"; done
cat "$ROOT/.cache/models/charsiu_vocab.json" > "$PUB/speech/charsiu_vocab.json"
for f in icon-180.png icon-192.png icon-512.png; do cat "$ROOT/assets/brand/$f" > "$ROOT/apps/web/public/$f"; done
if [ "${NATIVE:-0}" = "1" ]; then rm -rf "$PUB/ort"; else
  for f in ort-wasm-simd-threaded.wasm ort-wasm-simd-threaded.mjs; do cat "$NM/onnxruntime-web/dist/$f" > "$PUB/ort/$f"; done
fi
if [ "${NATIVE:-0}" != "1" ]; then
  mkdir -p "$PUB/models"
  cat "$ROOT/.cache/models/phone_ctc.int8.onnx" > "$PUB/models/phone_ctc.int8.onnx"
else
  rm -rf "$PUB/models"
fi
# 示范读音：预生成音频（spikes/tts/gen.mjs 产物）+ 浏览器内合成用的 Kokoro
TTS=$ROOT/.cache/models/kokoro/onnx-community/Kokoro-82M-v1.0-ONNX
TNM=$ROOT/content/audio/node_modules
mkdir -p "$PUB/tts/samples"
for f in "$ROOT"/spikes/m0/web/tts/samples/*; do cat "$f" > "$PUB/tts/samples/$(basename "$f")"; done
# App（NATIVE=1）不带 Kokoro：示范音频走音频包（sayday.ivyea.com/audio/），否则安装包要多 110MB
rm -rf "$PUB/tts/onnx-community" "$PUB/tts/lib" "$PUB/tts/ort"
mkdir -p "$PUB/tts/onnx-community/Kokoro-82M-v1.0-ONNX/onnx" "$PUB/tts/onnx-community/Kokoro-82M-v1.0-ONNX/voices" "$PUB/tts/lib" "$PUB/tts/ort"
if [ "${NATIVE:-0}" = "1" ]; then
  rm -rf "$PUB/tts/onnx-community" "$PUB/tts/lib" "$PUB/tts/ort"
elif [ -f "$TTS/onnx/model_quantized.onnx" ] && [ -f "$TNM/kokoro-js/dist/kokoro.web.js" ]; then
  for f in config.json tokenizer.json tokenizer_config.json onnx/model_quantized.onnx voices/af_heart.bin voices/bf_emma.bin; do cat "$TTS/$f" > "$PUB/tts/onnx-community/Kokoro-82M-v1.0-ONNX/$f"; done
  cat "$TNM/kokoro-js/dist/kokoro.web.js" > "$PUB/tts/lib/kokoro.web.js"
  for f in ort-wasm-simd-threaded.jsep.mjs ort-wasm-simd-threaded.jsep.wasm; do cat "$TNM/onnxruntime-web/dist/$f" > "$PUB/tts/ort/$f"; done
else
  echo "（没有 Kokoro 模型或 kokoro-js：自定义句子的示范读音不可用，预置句子不受影响）"
fi
du -sh "$PUB"
