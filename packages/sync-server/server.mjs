// 日日说同步服务：多设备同步 + 学习搭子小组。只存加密后的数据块，服务器看不到内容。
//
// 加密在客户端做（apps/web/src/lib/sync.ts）：同步码 → 账号 id（哈希）+ 密钥（AES-GCM）。服务器只认 id，拿不到密钥。
//   PUT    /v1/a/<账号>/d/<设备>     上传这台设备的最新快照（覆盖），≤ 6MB
//   GET    /v1/a/<账号>             列出各设备快照：[{ dev, ts, size }]
//   GET    /v1/a/<账号>/d/<设备>     下载某台设备的快照
//   DELETE /v1/a/<账号>/d/<设备>     这台设备退出同步
//   PUT    /v1/g/<小组>/m/<成员>     学习搭子：更新自己的小卡片（加密，≤ 4KB）
//   GET    /v1/g/<小组>             取小组里所有人的卡片
//   DELETE /v1/g/<小组>/m/<成员>     退出小组
// 只监听 127.0.0.1，由 nginx 转发 /api/sync/。磁盘剩余不足 MIN_FREE_MB 时拒绝写入；每个 IP 每分钟最多 RATE 次。
import http from 'node:http'
import { mkdir, readFile, readdir, rm, stat, statfs, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

const PORT = Number(process.env.PORT ?? 5296)
const DATA = process.env.DATA_DIR ?? '/var/lib/sayday-sync'
const MIN_FREE_MB = Number(process.env.MIN_FREE_MB ?? 2048)
const RATE = Number(process.env.RATE ?? 120)
const MAX_SNAPSHOT = 6 * 1024 * 1024
const MAX_CARD = 4 * 1024
const MAX_DEVICES = 8
const MAX_MEMBERS = 30
const ID = /^[a-f0-9]{32,64}$/

const hits = new Map()
setInterval(() => hits.clear(), 60_000).unref()

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}
const fail = (res, code, msg) => send(res, code, { error: msg })

async function readBody(req, max) {
  const chunks = []
  let n = 0
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('太大了'), { code: 413 }); chunks.push(c) }
  return Buffer.concat(chunks)
}
async function diskOk() {
  try { await mkdir(DATA, { recursive: true }); const s = await statfs(DATA); return (s.bavail * s.bsize) / 1048576 >= MIN_FREE_MB } catch { return false }
}
/** 先写临时文件再改名：写到一半断电不会留下半个快照 */
async function put(file, buf) {
  await writeFile(file + '.tmp', buf)
  await rename(file + '.tmp', file)
}
async function list(dir) {
  try {
    const names = (await readdir(dir)).filter((f) => f.endsWith('.bin'))
    return Promise.all(names.map(async (f) => { const s = await stat(join(dir, f)); return { id: f.slice(0, -4), ts: Math.round(s.mtimeMs), size: s.size } }))
  } catch { return [] }
}

export function handler(req, res) {
  return (async () => {
    if (req.method === 'OPTIONS') return send(res, 204, '')
    const ip = req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? ''
    const n = (hits.get(ip) ?? 0) + 1
    hits.set(ip, n)
    if (n > RATE) return fail(res, 429, '请求太频繁，稍后再试')
    const path = new URL(req.url, 'http://x').pathname.replace(/^\/api\/sync/, '')
    if (path === '/v1/health') return send(res, 200, { ok: true })
    let m = path.match(/^\/v1\/a\/([^/]+)(?:\/d\/([^/]+))?$/)
    if (m) {
      const [, acct, dev] = m
      if (!ID.test(acct) || (dev && !ID.test(dev))) return fail(res, 400, '账号或设备 id 不对')
      const dir = join(DATA, 'a', acct)
      if (!dev && req.method === 'GET') return send(res, 200, { devices: (await list(dir)).map((d) => ({ dev: d.id, ts: d.ts, size: d.size })) })
      if (!dev) return fail(res, 405, '不支持')
      const file = join(dir, dev + '.bin')
      if (req.method === 'GET') { try { return send(res, 200, await readFile(file), 'application/octet-stream') } catch { return fail(res, 404, '没有这台设备的数据') } }
      if (req.method === 'DELETE') { await rm(file, { force: true }); return send(res, 200, { ok: true }) }
      if (req.method === 'PUT') {
        if (!(await diskOk())) return fail(res, 507, '服务器空间不足，稍后再试')
        const body = await readBody(req, MAX_SNAPSHOT)
        if (body.length < 13) return fail(res, 400, '数据不对')
        const others = (await list(dir)).filter((d) => d.id !== dev)
        if (others.length >= MAX_DEVICES) return fail(res, 409, `最多 ${MAX_DEVICES} 台设备，请先在别的设备上退出同步`)
        await mkdir(dir, { recursive: true })
        await put(file, body)
        return send(res, 200, { ok: true, ts: Date.now() })
      }
      return fail(res, 405, '不支持')
    }
    m = path.match(/^\/v1\/g\/([^/]+)(?:\/m\/([^/]+))?$/)
    if (m) {
      const [, group, member] = m
      if (!ID.test(group) || (member && !ID.test(member))) return fail(res, 400, '小组或成员 id 不对')
      const dir = join(DATA, 'g', group)
      if (!member && req.method === 'GET') {
        const ms = await list(dir)
        const out = await Promise.all(ms.map(async (x) => ({ id: x.id, ts: x.ts, data: (await readFile(join(dir, x.id + '.bin'))).toString('base64') })))
        return send(res, 200, { members: out })
      }
      if (!member) return fail(res, 405, '不支持')
      const file = join(dir, member + '.bin')
      if (req.method === 'DELETE') { await rm(file, { force: true }); return send(res, 200, { ok: true }) }
      if (req.method === 'PUT') {
        if (!(await diskOk())) return fail(res, 507, '服务器空间不足，稍后再试')
        const body = await readBody(req, MAX_CARD)
        const others = (await list(dir)).filter((d) => d.id !== member)
        if (others.length >= MAX_MEMBERS) return fail(res, 409, `一个小组最多 ${MAX_MEMBERS} 人`)
        await mkdir(dir, { recursive: true })
        await put(file, body)
        return send(res, 200, { ok: true })
      }
      return fail(res, 405, '不支持')
    }
    return fail(res, 404, '没有这个接口')
  })().catch((e) => {
    // 太大的请求体没读完：回完话关掉连接，别让客户端复用这条连接
    if (e.code === 413) { res.setHeader('connection', 'close'); res.once('finish', () => req.destroy()); return fail(res, 413, '数据太大了') }
    fail(res, 500, '服务器出错了')
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(DATA, { recursive: true })
  http.createServer(handler).listen(PORT, '127.0.0.1', () => console.log(`sayday-sync on 127.0.0.1:${PORT}, data ${DATA}`))
}
