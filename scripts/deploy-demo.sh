#!/usr/bin/env bash
# 把 M0 演示页（spikes/m0/web + 运行时依赖 + 模型）发布到静态目录。
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
for f in index.html app.js db-worker.js demo.html demo.js infer-worker.js gop.mjs calib.mjs sw.js; do cat "$M0/web/$f" > "$STAGE/web/$f"; done
for f in calib.json cmudict.min.json cmudict.LICENSE meta.json u0.f32 u0.ref.f32 u1.f32 u1.ref.f32 u2.f32 u2.ref.f32; do cat "$M0/web/samples/$f" > "$STAGE/web/samples/$f"; done
for f in phone_ctc.int8.onnx charsiu_vocab.json; do cat "$ROOT/.cache/models/$f" > "$STAGE/web/models/$f"; done
for f in ort.wasm.min.mjs ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do cat "$NM/onnxruntime-web/dist/$f" > "$STAGE/node_modules/onnxruntime-web/dist/$f"; done
for f in sqlite3-bundler-friendly.mjs sqlite3.wasm sqlite3-opfs-async-proxy.js; do cat "$NM/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/$f" > "$STAGE/node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/$f"; done

# 先放到同级临时目录，再整体替换，避免发布中途页面读到半套文件
NEW="$DEST.new.$$"
rm -rf "$NEW"
cp -r "$STAGE" "$NEW"
if [ -d "$DEST" ]; then rm -rf "$DEST.old"; mv "$DEST" "$DEST.old"; fi
mv "$NEW" "$DEST"
rm -rf "$DEST.old"
chmod -R a+rX "$DEST"
du -sh "$DEST"
