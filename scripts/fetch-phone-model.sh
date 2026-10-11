#!/usr/bin/env bash
# 准备音素打分模型（给 packages/agent 这类在电脑 / 服务器上跑的场景）：
#   从 GitHub 最新 Release 的安卓安装包里取出 int8 模型（App 里就是这一份），再从 Hugging Face 取音素表。
#   自己从原始权重导出见 spikes/m0/export_onnx.py（要装 torch）。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
D=${SAYDAY_MODELS:-$ROOT/.cache/models}
mkdir -p "$D"
if [ ! -s "$D/phone_ctc.int8.onnx" ]; then
  url=$(curl -fsSL https://api.github.com/repos/Hector-xue/sayday/releases?per_page=1 | python3 -c "import json,sys; r=json.load(sys.stdin)[0]; print(next(a['browser_download_url'] for a in r['assets'] if a['name'].endswith('.apk')))")
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  echo "下载 $url"
  curl -fSL -o "$tmp/app.apk" "$url"
  python3 -c "import zipfile,sys; open(sys.argv[2],'wb').write(zipfile.ZipFile(sys.argv[1]).read('assets/models/phone_ctc.int8.onnx'))" "$tmp/app.apk" "$D/phone_ctc.int8.onnx"
fi
[ -s "$D/charsiu_vocab.json" ] || curl -fsSL -o "$D/charsiu_vocab.json" https://huggingface.co/charsiu/tokenizer_en_cmu/resolve/main/vocab.json
ls -la "$D/phone_ctc.int8.onnx" "$D/charsiu_vocab.json"
