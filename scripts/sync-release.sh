#!/usr/bin/env bash
# 把 GitHub 最新 Release（含预发布）的安卓包同步到门户下载目录，生成 version.json。
# 门户“下载”按钮读 version.json：主线路走 GitHub，本站这份做备用线路（国内 GitHub 慢时用）。幂等：版本没变直接退出。
#   crontab: */20 * * * * flock -n /tmp/sayday-sync.lock /root/sayday/scripts/sync-release.sh >> /var/log/sayday-sync.log 2>&1
# 仓库公开，token 只为放宽 API 限流；从 git 凭据库取，不落盘不打印。
set -euo pipefail

REPO="Hector-xue/sayday"
DEST="${DEST:-/var/www/sayday.ivyea.com/download}"
MIRROR_BASE="https://sayday.ivyea.com/download"
FIXED="sayday-android-arm64.apk"
mkdir -p "$DEST"

auth=()
tok=$(printf 'protocol=https\nhost=github.com\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' || true)
[ -n "$tok" ] && auth=(-H "Authorization: Bearer $tok")

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# releases/latest 不含预发布，取列表里第一条 App 版本（按发布时间倒序；只认 v 开头的 tag，模型等其他 Release 跳过）
curl -fsSL --max-time 30 "${auth[@]}" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases?per_page=20" > "$tmp/list.json"
python3 - "$tmp/list.json" > "$tmp/plan" <<'PY'
import json, sys
r = next((x for x in json.load(open(sys.argv[1])) if x["tag_name"].startswith("v") and not x.get("draft")), None)
if not r:
    sys.exit("没有 App 版本的 Release")
apk = next((a for a in r["assets"] if a["name"].endswith(".apk")), None)
if not apk:
    sys.exit("最新 Release 没有 apk")
print("\t".join([r["tag_name"], apk["name"], apk["url"], str(apk["size"]), apk["browser_download_url"], r.get("published_at") or "", str(r.get("prerelease", False)).lower(), r["html_url"]]))
json.dump(r.get("body") or "", open(sys.argv[1] + ".notes", "w"), ensure_ascii=False)
PY
IFS=$'\t' read -r tag name url size gh_url published pre release_url < "$tmp/plan"
version="${tag#v}"

current=$(python3 -c "import json; print(json.load(open('$DEST/version.json'))['version'])" 2>/dev/null || true)
if [ "$current" = "$version" ] && [ -f "$DEST/$FIXED" ] && [ "${FORCE:-0}" != "1" ]; then
    exit 0
fi
echo "$(date '+%F %T') 同步 $tag（当前 ${current:-无}）"

curl -fsSL --max-time 900 "${auth[@]}" -H "Accept: application/octet-stream" -o "$tmp/$FIXED" "$url"
got=$(stat -c %s "$tmp/$FIXED")
[ "$got" = "$size" ] || { echo "大小不对：$got != $size"; exit 1; }
sha=$(sha256sum "$tmp/$FIXED" | cut -d' ' -f1)
mv -f "$tmp/$FIXED" "$DEST/$FIXED"
chmod a+r "$DEST/$FIXED"

python3 - "$version" "$tag" "$published" "$pre" "$gh_url" "$MIRROR_BASE/$FIXED" "$sha" "$size" "$tmp/list.json.notes" "$release_url" > "$DEST/version.json.tmp" <<'PY'
import json, sys
version, tag, published, pre, gh, mirror, sha, size, notes, release_url = sys.argv[1:]
print(json.dumps({
    "version": version, "tag": tag, "published_at": published, "prerelease": pre == "true",
    "notes": json.load(open(notes))[:3000],
    "android_arm64_url": gh, "android_arm64_sha256": sha, "android_arm64_size": int(size),
    # 电脑版 / 浏览器插件按钮直达这一版的 Release 页（releases/latest 不含预发布，列表最上面也可能是模型、音频备份）
    "release_url": release_url,
    "mirror": {"android_arm64_url": mirror},
    "page": "https://sayday.ivyea.com/",
}, ensure_ascii=False, indent=2))
PY
mv -f "$DEST/version.json.tmp" "$DEST/version.json"
chmod a+r "$DEST/version.json"
echo "$(date '+%F %T') 完成 $tag"
