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

if [ "${ONLY:-}" = "e" ]; then
  # 只换剧集目录 e/，句子 s/ 和单词 w/ 一个文件都不碰
  # content-episodes：美音 / 英音各 4 片
  [ "$n" -eq 8 ] || { echo "剧集产物不全：$n/8"; exit 1; }
  for acc in us gb; do
    c=$(ls "$TMP/audio/$acc/e" | wc -l)
    [ "$c" -gt 0 ] || { echo "$acc 没有剧集音频"; exit 1; }
    # 剧集 / 听力只会越加越多：比线上少就是拿错了产物，不发布
    old=$(ls "$DEST/$acc/e" 2>/dev/null | wc -l)
    [ "$c" -ge "$old" ] || { echo "$acc 剧集音频比线上少（$old → $c），不发布"; exit 1; }
    echo "$acc 剧集 $old → $c"
    chmod -R a+rX "$TMP/audio/$acc/e"
    rm -rf "$DEST/$acc/e.new" && mv "$TMP/audio/$acc/e" "$DEST/$acc/e.new"
    if [ -d "$DEST/$acc/e" ]; then mv "$DEST/$acc/e" "$DEST/$acc/e.old"; fi
    mv "$DEST/$acc/e.new" "$DEST/$acc/e" && rm -rf "$DEST/$acc/e.old"
  done
  exit 0
fi
# 全量：必须 32 片齐全，而且句子、单词都不能是空的（防止拿错产物把整个音频包换空）
[ "$n" -eq 32 ] || { echo "分片不全：$n/32"; exit 1; }
for acc in us gb; do
  echo "$acc 句子 $(ls "$TMP/audio/$acc/s" | wc -l) · 单词 $(ls "$TMP/audio/$acc/w" | wc -l) · 剧集 $(ls "$TMP/audio/$acc/e" | wc -l)"
  [ "$(ls "$TMP/audio/$acc/s" | wc -l)" -gt 10000 ] && [ "$(ls "$TMP/audio/$acc/w" | wc -l)" -gt 10000 ] || { echo "$acc 句子或单词数量不对，不发布"; exit 1; }
done
# 全量产物里没有剧集时，保留线上已有的剧集音频
for acc in us gb; do
  if [ -z "$(ls -A "$TMP/audio/$acc/e")" ] && [ -d "$DEST/$acc/e" ]; then rmdir "$TMP/audio/$acc/e"; cp -r "$DEST/$acc/e" "$TMP/audio/$acc/e"; fi
done
chmod -R a+rX "$TMP/audio"
rm -rf "$DEST.new" && mv "$TMP/audio" "$DEST.new"
[ -d "$DEST" ] && mv "$DEST" "$DEST.old"
mv "$DEST.new" "$DEST" && rm -rf "$DEST.old"
du -sh "$DEST"
