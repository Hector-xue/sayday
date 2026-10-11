#!/usr/bin/env bash
# 下载离线语音识别模型 Moonshine base（MIT，onnx-community 的 int8 导出）到 .cache/models/asr/moonshine-base，
# 并把 tokenizer.json 压成只有词表的 vocab.json（packages/asr/moonshine.mjs 解码用）
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
D=$ROOT/.cache/models/asr/moonshine-base
HF=https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main
mkdir -p "$D/onnx"
for f in onnx/encoder_model_quantized.onnx onnx/decoder_model_merged_quantized.onnx tokenizer.json config.json; do
  [ -s "$D/$f" ] || curl -sSfL -o "$D/$f" "$HF/$f"
done
python3 - "$D" <<'PY'
import json, sys
d = sys.argv[1]
t = json.load(open(f'{d}/tokenizer.json'))
arr = [''] * 32768
for k, i in t['model']['vocab'].items(): arr[i] = k
for a in t['added_tokens']: arr[a['id']] = a['content']
json.dump(arr, open(f'{d}/vocab.json', 'w'), ensure_ascii=False, separators=(',', ':'))
PY
ls -la "$D/onnx" "$D/vocab.json"
