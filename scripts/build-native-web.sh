#!/usr/bin/env bash
# 组装 App 前端产物 apps/native/dist：就是 apps/web 的正式版界面（NATIVE=1：不带网页模型和 Kokoro，推理走原生插件）。
# 依赖 .cache/models/charsiu_vocab.json（CI 里由模型导出步骤生成）和 content/pack（已入库）。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT/apps/web"
[ -d node_modules ] || npm ci --no-audit --no-fund
NATIVE=1 bash "$ROOT/scripts/prepare-web-assets.sh"
npx tsc --noEmit
npx vite build --outDir "$ROOT/apps/native/dist" --emptyOutDir
du -sh "$ROOT/apps/native/dist"
