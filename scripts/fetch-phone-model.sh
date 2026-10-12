#!/usr/bin/env bash
# 准备音素打分模型（给 packages/agent 这类在电脑 / 服务器上跑的场景，以及本地构建网页版）：
#   从 Release「model-phone-ftall」下载口音微调过的 int8 模型（App 里就是这一份，按 sha256 校验），再从 Hugging Face 取音素表。
#   App 的评分校准表 packages/speech/calib.json 是按这一份模型拟合的，换模型必须一起换（见 docs/口音微调方案.md）。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
D=${SAYDAY_MODELS:-$ROOT/.cache/models}
URL=https://github.com/Hector-xue/sayday/releases/download/model-phone-ftall/phone_ctc.ftall.int8.onnx
SHA=fb7686d1a479ddc0da84bd1dd5bc87d8f212dd83e8bc41190b7c471b8c89d849
mkdir -p "$D"
if [ ! -s "$D/phone_ctc.int8.onnx" ] || ! echo "$SHA  $D/phone_ctc.int8.onnx" | sha256sum -c --status -; then
  echo "下载 $URL"
  curl -fSL --retry 3 -o "$D/phone_ctc.int8.onnx.part" "$URL"
  echo "$SHA  $D/phone_ctc.int8.onnx.part" | sha256sum -c -
  mv -f "$D/phone_ctc.int8.onnx.part" "$D/phone_ctc.int8.onnx"
fi
[ -s "$D/charsiu_vocab.json" ] || curl -fsSL -o "$D/charsiu_vocab.json" https://huggingface.co/charsiu/tokenizer_en_cmu/resolve/main/vocab.json
ls -la "$D/phone_ctc.int8.onnx" "$D/charsiu_vocab.json"
