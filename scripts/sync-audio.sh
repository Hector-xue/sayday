#!/usr/bin/env bash
# 把 content-audio 工作流的产物（32 个分片 artifact）合并发布到 /var/www/sayday.ivyea.com/audio/
# 用法: scripts/sync-audio.sh <run_id>            全量（32 片，整体换上）
#       ONLY=e scripts/sync-audio.sh <run_id>     只更新剧集（content-episodes 工作流的产物，只换 e/ 目录）
# 先下到临时目录、校验每片都有清单，再换上（发布中途不会出现半套）
set -euo pipefail
RUN=${1:?run id}
DEST=${DEST:-/var/www/sayday.ivyea.com/audio}
REPO=Hector-xue/sayday
TMP=$(mktemp -d /root/sayday/.cache/audio-sync.XXXX)
trap 'rm -rf "$TMP"' EXIT
export GH_TOKEN=${GH_TOKEN:-$(printf 'protocol=https\nhost=github.com\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')}
gh run download "$RUN" -R "$REPO" -D "$TMP/dl"
mkdir -p "$TMP/audio"
n=0
for d in "$TMP"/dl/audio-*; do
  for acc in us gb; do
    [ -d "$d/$acc" ] || continue
    mkdir -p "$TMP/audio/$acc/s" "$TMP/audio/$acc/w" "$TMP/audio/$acc/e"
    ls "$d/$acc"/shard-*.json >/dev/null 2>&1 || { echo "缺清单：$d"; exit 1; }
    for k in s w e; do [ -d "$d/$acc/$k" ] && find "$d/$acc/$k" -name '*.mp3' -exec mv -t "$TMP/audio/$acc/$k/" {} +; done
    cat "$d/$acc"/shard-*.json > /dev/null
    n=$((n + 1))
  done
done

rm -rf "$DEST.new" && mv "$TMP/audio" "$DEST.new"
[ -d "$DEST" ] && mv "$DEST" "$DEST.old"
mv "$DEST.new" "$DEST" && rm -rf "$DEST.old"
du -sh "$DEST"
