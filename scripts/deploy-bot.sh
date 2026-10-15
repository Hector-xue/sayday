#!/usr/bin/env bash
# 部署聊天机器人（packages/bot）：systemd 服务 sayday-bot，凭据在 /etc/sayday-bot.env（见 docs/机器人.md）。
# 从仓库目录直接跑（要用 packages/agent 的打分代码和 .cache/models 里的模型）。
# 机器人靠自建同步服务读写学习记录，先跑 scripts/deploy-sync.sh。
# 飞书默认长连接、Telegram 长轮询，都不用公网地址；飞书改用回调地址时自己在反向代理里把 /api/bot/feishu 转到 127.0.0.1:5299
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-$(readlink -f "$(command -v node)")}
ENVF=/etc/sayday-bot.env
[ -f "$ENVF" ] || { echo "先建 $ENVF（模板见 docs/机器人.md），至少填 TELEGRAM_TOKEN 或 FEISHU_APP_ID/FEISHU_APP_SECRET"; exit 1; }
chmod 600 "$ENVF"
(cd "$ROOT/packages/bot" && npm ci --registry=https://registry.npmjs.org --no-audit --no-fund >/dev/null)
mkdir -p /var/lib/sayday-bot
cat > /etc/systemd/system/sayday-bot.service <<UNIT
[Unit]
Description=日日说聊天机器人（Telegram / 飞书：每天推复习题、聊天里作答、语音纠音）
After=network-online.target sayday-sync.service

[Service]
WorkingDirectory=$ROOT/packages/bot
ExecStart=$NODE $ROOT/packages/bot/bot.mjs
EnvironmentFile=$ENVF
Environment=DATA_DIR=/var/lib/sayday-bot
Restart=on-failure
RestartSec=5
MemoryMax=900M
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/sayday-bot

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable sayday-bot.service >/dev/null 2>&1
systemctl restart sayday-bot.service
sleep 3
systemctl --no-pager -l status sayday-bot.service | tail -5
