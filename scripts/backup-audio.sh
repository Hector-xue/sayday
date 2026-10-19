#!/usr/bin/env bash
# 线上示范音频包（/var/www/sayday.ivyea.com/audio）备份到 GitHub Release `audio-pack`，出事时一键恢复。
# CI 产物只保留 3 天、重新合成要跑 32 片，所以每次发布完音频包都备份一次。
# 用法: scripts/backup-audio.sh backup     打包线上音频包，上传（覆盖 Release 里的旧备份）
#       scripts/backup-audio.sh restore    从 Release 下载、校验，整体换上（先下到临时目录，发布中途不会出现半套）
# 只认 audio-pack 这个标签，建成预发布（不能抢“Latest”：门户的下载按钮会跟着跳过来）；sync-release.sh / fetch-phone-model.sh 只看 v* 的 Release，不受影响
set -euo pipefail
MODE=${1:?backup 或 restore}
DEST=${DEST:-/var/www/sayday.ivyea.com/audio}
REPO=Hector-xue/sayday
TAG=audio-pack
NAME=sayday-audio.tar
mkdir -p /root/sayday/.cache
TMP=$(mktemp -d /root/sayday/.cache/audio-backup.XXXX)
trap 'rm -rf "$TMP"' EXIT
export GH_TOKEN=${GH_TOKEN:-$(printf 'protocol=https\nhost=github.com\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')}

# 句子、单词数量不对就不认（和 sync-audio.sh 全量发布同一道防呆）
check() {
  for acc in us gb; do
    s=$(find "$1/$acc/s" -name '*.mp3' | wc -l); w=$(find "$1/$acc/w" -name '*.mp3' | wc -l); e=$(find "$1/$acc/e" -name '*.mp3' 2>/dev/null | wc -l)
    echo "$acc 句子 $s · 单词 $w · 剧集 $e"
    [ "$s" -gt 10000 ] && [ "$w" -gt 10000 ] || { echo "$acc 句子或单词数量不对"; return 1; }
  done
}

if [ "$MODE" = "backup" ]; then
  check "$DEST"
  # mp3 本来就压缩过，只打包不再压缩
  tar -C "$DEST" -cf "$TMP/$NAME" us gb have.txt
  (cd "$TMP" && sha256sum "$NAME" > "$NAME.sha256")
  echo "打包 $(du -h "$TMP/$NAME" | cut -f1)"
  if ! gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
    gh release create "$TAG" -R "$REPO" --title "示范音频包备份" --prerelease --latest=false \
      --notes "sayday.ivyea.com/audio 的完整备份（不是 App 版本）。恢复：scripts/backup-audio.sh restore"
  fi
  gh release upload "$TAG" -R "$REPO" --clobber "$TMP/$NAME" "$TMP/$NAME.sha256"
  gh release edit "$TAG" -R "$REPO" --notes "sayday.ivyea.com/audio 的完整备份（不是 App 版本），备份于 $(date '+%F %H:%M')，$(wc -l < "$DEST/have.txt") 条。恢复：scripts/backup-audio.sh restore" >/dev/null
  echo "已备份到 Release $TAG"
  exit 0
fi

if [ "$MODE" = "restore" ]; then
  gh release download "$TAG" -R "$REPO" -D "$TMP" -p "$NAME" -p "$NAME.sha256"
  (cd "$TMP" && sha256sum -c "$NAME.sha256")
  mkdir "$TMP/audio" && tar -C "$TMP/audio" -xf "$TMP/$NAME" && rm "$TMP/$NAME"
  check "$TMP/audio"
  chmod -R a+rX "$TMP/audio"
  rm -rf "$DEST.new" && mv "$TMP/audio" "$DEST.new"
  if [ -d "$DEST" ]; then mv "$DEST" "$DEST.old"; fi
  mv "$DEST.new" "$DEST" && rm -rf "$DEST.old"
  du -sh "$DEST"
  exit 0
fi
echo "用法: $0 backup|restore"; exit 1
