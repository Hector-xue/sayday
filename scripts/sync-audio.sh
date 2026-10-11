#!/usr/bin/env bash
# 把 content-audio 工作流的产物（32 个分片 artifact）合并发布到 /var/www/sayday.ivyea.com/audio/
# 用法: scripts/sync-audio.sh <run_id>
# 先下到临时目录、校验每片都有清单，再整体换上（发布中途不会出现半套）
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
    mkdir -p "$TMP/audio/$acc/s" "$TMP/audio/$acc/w"
    ls "$d/$acc"/shard-*.json >/dev/null 2>&1 || { echo "缺清单：$d"; exit 1; }
    find "$d/$acc/s" -name '*.mp3' -exec mv -t "$TMP/audio/$acc/s/" {} +
    find "$d/$acc/w" -name '*.mp3' -exec mv -t "$TMP/audio/$acc/w/" {} +
    cat "$d/$acc"/shard-*.json > /dev/null
    n=$((n + 1))
  done
done
[ "$n" -eq 32 ] || { echo "分片不全：$n/32"; exit 1; }
for acc in us gb; do echo "$acc 句子 $(ls "$TMP/audio/$acc/s" | wc -l) · 单词 $(ls "$TMP/audio/$acc/w" | wc -l)"; done
chmod -R a+rX "$TMP/audio"
rm -rf "$DEST.new" && mv "$TMP/audio" "$DEST.new"
[ -d "$DEST" ] && mv "$DEST" "$DEST.old"
mv "$DEST.new" "$DEST" && rm -rf "$DEST.old"
du -sh "$DEST"
