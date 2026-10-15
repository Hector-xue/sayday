#!/usr/bin/env bash
# 部署自建同步服务（packages/sync-server）：拷到 /opt/sayday-sync，装 systemd 服务，监听 127.0.0.1:5296，数据在 /var/lib/sayday-sync。
# App 要连的话，在你的反向代理（要 HTTPS）里把 /api/sync/ 转到这里，App 设置 → 自建同步服务器 填 https://你的域名/api/sync（见 docs/机器人.md）
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-$(readlink -f "$(command -v node)")}
mkdir -p /opt/sayday-sync /var/lib/sayday-sync
cat "$ROOT/packages/sync-server/server.mjs" > /opt/sayday-sync/server.mjs
cat > /etc/systemd/system/sayday-sync.service <<UNIT
[Unit]
Description=日日说自建同步服务（只存加密数据）
After=network.target

[Service]
ExecStart=$NODE /opt/sayday-sync/server.mjs
Environment=PORT=5296 DATA_DIR=/var/lib/sayday-sync MIN_FREE_MB=1500 RATE=120
Restart=on-failure
RestartSec=3
MemoryMax=256M
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/sayday-sync

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable sayday-sync.service >/dev/null 2>&1
systemctl restart sayday-sync.service
sleep 1
curl -fsS http://127.0.0.1:5296/api/sync/v1/health && echo
