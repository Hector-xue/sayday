#!/usr/bin/env bash
# 把 apps/web 运行时要的大文件放进 apps/web/public（不进仓库）：
#   content/   内容包（content/pack，由 content/build_content.py 生成）
#   speech/    评分校准、CMU 词典、音素表
#   models/    音素识别模型（.cache/models，NATIVE=1 时跳过：App 里走原生插件自带的模型）
#   ort/       onnxruntime-web 的 wasm（网页打分 + 两端的语音识别）
#   tts/       预置示范音频（其余走音频包，现编句子用系统语音）
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PUB=$ROOT/apps/web/public
NM=$ROOT/apps/web/node_modules
mkdir -p "$PUB/content" "$PUB/speech" "$PUB/ort"
for f in words.json sentences.json pseudo.json meta.json; do cat "$ROOT/content/pack/$f" > "$PUB/content/$f"; done
# 剧集台词（content/episodes，手写；配音由 content-episodes 工作流生成到音频包）
for f in "$ROOT"/content/episodes/s*.json; do cat "$f" > "$PUB/content/episodes-$(basename "$f")"; done
# 雅思口语模考题库（原创题目）
cat "$ROOT/content/ielts/speaking.json" > "$PUB/content/ielts-speaking.json"
cat "$ROOT/content/ielts/writing.json" > "$PUB/content/ielts-writing.json"
for k in reading listening; do cat "$ROOT/content/ielts/$k.json" > "$PUB/content/ielts-$k.json"; done
# 工作英语（content/work，跨境电商场景）
cat "$ROOT/content/work/tasks.json" > "$PUB/content/work.json"
# 每日彩蛋（content/eggs）
cat "$ROOT/content/eggs/eggs.json" > "$PUB/content/eggs.json"
for f in calib.json cmudict.min.json cmudict.LICENSE; do cat "$ROOT/packages/speech/$f" > "$PUB/speech/$f"; done
cat "$ROOT/.cache/models/charsiu_vocab.json" > "$PUB/speech/charsiu_vocab.json"
for f in icon-180.png icon-192.png icon-512.png icon-maskable-512.png; do cat "$ROOT/assets/brand/$f" > "$ROOT/apps/web/public/$f"; done
# App 里也要：音素打分走原生插件，但语音识别（Moonshine）在 WebView 里用 wasm 跑
for f in ort-wasm-simd-threaded.wasm ort-wasm-simd-threaded.mjs; do cat "$NM/onnxruntime-web/dist/$f" > "$PUB/ort/$f"; done
if [ "${NATIVE:-0}" != "1" ]; then
  mkdir -p "$PUB/models"
  cat "$ROOT/.cache/models/phone_ctc.int8.onnx" > "$PUB/models/phone_ctc.int8.onnx"
else
  rm -rf "$PUB/models"
fi
# 示范读音：预置句子的音频（spikes/tts/gen.mjs 产物）。其余例句 / 单词走音频包（sayday.ivyea.com/audio/），
# 现编的句子用系统语音；浏览器里的 Kokoro 已去掉（kokoro-js 依赖 GPL 的 eSpeak NG）
mkdir -p "$PUB/tts/samples"
for f in "$ROOT"/spikes/m0/web/tts/samples/*; do cat "$f" > "$PUB/tts/samples/$(basename "$f")"; done
rm -rf "$PUB/tts/onnx-community" "$PUB/tts/lib" "$PUB/tts/ort"
du -sh "$PUB"
