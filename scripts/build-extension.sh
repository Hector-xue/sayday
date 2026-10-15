#!/usr/bin/env bash
# 组装浏览器插件（extensions/browser）→ dist/extension/，再打成 zip（Chrome / Edge：扩展程序 → 开发者模式 → 加载已解压的 / 拖入 zip 解压后的目录）
# 加密和 App、机器人同一份（packages/bot/crypto.mjs），词表从内容包生成
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/dist/extension"
V=${1:-$(python3 -c "import json; print(json.load(open('$ROOT/extensions/browser/manifest.json'))['version'])")}
rm -rf "$OUT" && mkdir -p "$OUT"
for f in manifest.json background.js content.js lib.js popup.html popup.js; do cat "$ROOT/extensions/browser/$f" > "$OUT/$f"; done
cat "$ROOT/packages/bot/crypto.mjs" > "$OUT/crypto.js"
cat "$ROOT/assets/brand/icon-32.png" > "$OUT/icon-32.png"
cat "$ROOT/assets/brand/icon-192.png" > "$OUT/icon-128.png"
python3 - "$ROOT/content/pack/words.json" "$OUT/words.json" "$OUT/manifest.json" "$V" <<'PY'
import json, sys
words = json.load(open(sys.argv[1]))
# { 词: [音标, 释义, 排名] }，敏感词不收
json.dump({w[0]: [w[3], w[4], w[1]] for w in words if not (len(w) > 7 and w[7] == 1)}, open(sys.argv[2], 'w'), ensure_ascii=False, separators=(',', ':'))
m = json.load(open(sys.argv[3])); m['version'] = sys.argv[4]
json.dump(m, open(sys.argv[3], 'w'), ensure_ascii=False, indent=2)
PY
(cd "$OUT" && python3 -c "import zipfile,os; z=zipfile.ZipFile('../sayday-extension-v$V.zip','w',zipfile.ZIP_DEFLATED); [z.write(f) for f in sorted(os.listdir('.'))]; z.close()")
du -sh "$OUT" "$ROOT/dist/sayday-extension-v$V.zip"
