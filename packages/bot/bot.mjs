// 日日说聊天机器人：读环境变量决定开哪些平台（有 Telegram token 就开 Telegram，有飞书应用凭据就开飞书），
// 每分钟检查一次要不要推今天的题。部署见 scripts/deploy-bot.sh，凭据放 /etc/sayday-bot.env
import { createBot, Store } from './core.mjs'
import { telegram } from './adapters/telegram.mjs'
import { feishu } from './adapters/feishu.mjs'
import { agentCore, decode } from './audio.mjs'

const env = process.env
// 自建同步服务（scripts/deploy-sync.sh，同一台机器上）
const API = env.SYNC_API ?? 'http://127.0.0.1:5296/api/sync'
const store = new Store(env.DATA_DIR ?? '/var/lib/sayday-bot')

// 打分、词表和 App 同一套（packages/agent/core.mjs，模型在仓库 .cache/models）
const { getContent, scoreAudio } = await agentCore()
const bot = createBot({ api: API, store, content: getContent(), score: scoreAudio, decode, tz: Number(env.TZ_MIN ?? 480) })
const senders = []
if (env.TELEGRAM_TOKEN) { const t = telegram({ token: env.TELEGRAM_TOKEN, onMessage: bot.handle }); t.start(); senders.push(['tg:', t.send]); console.log('Telegram 已开') }
if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET) { const f = feishu({ appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET, verifyToken: env.FEISHU_VERIFY_TOKEN ?? '', port: Number(env.FEISHU_PORT ?? 5299), onMessage: bot.handle }); f.start(); senders.push(['fs:', f.send]); console.log('飞书已开') }
if (!senders.length) console.log('没有配置任何平台的凭据（TELEGRAM_TOKEN / FEISHU_APP_ID + FEISHU_APP_SECRET），只空转')
const send = (chat, m) => { const s = senders.find(([p]) => chat.startsWith(p)); return s ? s[1](chat, m) : Promise.resolve() }
setInterval(() => bot.tick(send).catch((e) => console.log('定时推送出错', e)), 60_000)
