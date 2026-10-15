// 多设备同步（方案 M4）：手机、网页、平板用同一个同步码，学习记录合到一起。
//
// 端到端加密：同步码只存在你的设备上。同步码 → 账号 id（哈希，服务器只认这个）+ AES-GCM 密钥（服务器拿不到）。
// 每台设备上传一份自己的完整快照（加密后的学习记录，录音不传），同步时把别的设备更新过的快照拉下来合进本机：
//   流水类的表（复习记录、跟读、聊天、日记……）取并集，按内容去重；
//   词卡取复习得更近的那份；每天的计数取较大值；
//   设置按修改时间新的覆盖旧的，几个累计型的（剧集进度、解锁的能力、开过的彩蛋……）合并。
// 服务端：packages/sync-server（sayday.ivyea.com/api/sync/）
import { db, kvGet, kvSet } from './db'

/** 同步服务地址；本地测试可以在 localStorage 里设 sayday-sync-api 指到本机的服务 */
export const API = (() => { try { return localStorage.getItem('sayday-sync-api') || 'https://sayday.ivyea.com/api/sync' } catch { return 'https://sayday.ivyea.com/api/sync' } })()

// ---------------- 同步码和加密 ----------------

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford：没有 I L O U，读和抄都不容易错
/** 新同步码：16 字节随机数（128 位），26 个字符，每 4 个一组 */
export function newCode(rnd: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = rnd(16)
  let bits = 0, v = 0, out = ''
  for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits) out += B32[(v << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)!.join('-')
}
/** 输入的同步码统一成大写、去分隔符；把容易看错的字母换回去（O→0、I/L→1） */
export function normCode(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}
export const validCode = (s: string) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(normCode(s))

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
async function sha(parts: string): Promise<ArrayBuffer> { return crypto.subtle.digest('SHA-256', enc.encode(parts)) }

export type Keys = { id: string; key: CryptoKey }
/** 同步码 → 账号 id + 加密密钥（scope 区分用途：个人同步 / 学习小组） */
export async function deriveKeys(code: string, scope: 'sync' | 'group' = 'sync'): Promise<Keys> {
  const base = `sayday-${scope}-v1:${normCode(code)}`
  const id = hex(await sha(base + ':id')).slice(0, 40)
  const key = await crypto.subtle.importKey('raw', await sha(base + ':key'), 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { id, key }
}

const canGzip = () => typeof CompressionStream !== 'undefined'
async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(t)).arrayBuffer())
}
/** 数据块：[版本 1][标志：1 = gzip][12 字节 iv][密文] */
export async function seal(obj: unknown, key: CryptoKey): Promise<Uint8Array> {
  let plain = enc.encode(JSON.stringify(obj))
  const gz = canGzip()
  if (gz) plain = await pipe(plain, new CompressionStream('gzip'))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  const out = new Uint8Array(14 + ct.length)
  out[0] = 1; out[1] = gz ? 1 : 0; out.set(iv, 2); out.set(ct, 14)
  return out
}
export async function open<T>(blob: Uint8Array, key: CryptoKey): Promise<T> {
  if (blob[0] !== 1) throw new Error('数据版本不认识，请先更新 App')
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(2, 14) }, key, blob.slice(14)))
  if (blob[1] & 1) plain = await pipe(plain, new DecompressionStream('gzip'))
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

// ---------------- 快照和合并 ----------------

type Row = Record<string, unknown>
/** 只在这台设备上有意义的设置：不传、也不被别的设备覆盖 */
const LOCAL_KV = new Set(['reminder', 'notify_quiz', 'backlog_spread', 'theme', 'text_size', 'sync', 'sync_seen', 'sync_device', 'buddy'])
const isLocalKv = (k: string) => LOCAL_KV.has(k) || k.startsWith('sync_')

/** 流水表：按内容去重的键（自增 id 不同步，各设备自己编） */
const LOGS: Record<string, (r: Row) => string> = {
  review_log: (r) => `${r.word}|${r.ts}`,
  attempt: (r) => `${r.text}|${r.ts}`,
  level_estimate: (r) => `${r.skill}|${r.ts}`,
  listen_log: (r) => `${r.sentence_id}|${r.ts}`,
  chat: (r) => `${r.role}|${r.ts}|${String(r.content).slice(0, 40)}`,
  diary: (r) => `${r.date}|${r.ts}`,
  speaking_test: (r) => `${r.ts}`,
  writing: (r) => `${r.prompt_id}|${r.ts}`,
  practice: (r) => `${r.kind}|${r.ts}`,
  work: (r) => `${r.task}|${r.ts}`,
}
const DAY_COUNTS = ['reviews', 'new_words', 'shadows', 'seconds', 'minimum', 'done', 'listens']

export type Snapshot = { v: 1; dev: string; ts: number; tables: Record<string, Row[]>; kv: Record<string, { v: string; ts: number }> }

export async function snapshot(dev: string): Promise<Snapshot> {
  const tables: Record<string, Row[]> = {}
  for (const t of ['card', 'phoneme_stat', 'day', ...Object.keys(LOGS)]) tables[t] = await db.all<Row>(`SELECT * FROM ${t}`)
  const kv: Snapshot['kv'] = {}
  const ts = new Map((await db.all<{ key: string; ts: number }>('SELECT key, ts FROM kv_ts')).map((r) => [r.key, r.ts]))
  for (const r of await db.all<{ key: string; value: string }>('SELECT key, value FROM kv')) if (!isLocalKv(r.key)) kv[r.key] = { v: r.value, ts: ts.get(r.key) ?? 0 }
  return { v: 1, dev, ts: Date.now(), tables, kv }
}

type Op = { sql: string; params?: unknown[] }
const insert = (t: string, r: Row, drop: string[] = ['id']): Op => {
  const ks = Object.keys(r).filter((k) => !drop.includes(k))
  return { sql: `INSERT INTO ${t}(${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`, params: ks.map((k) => r[k]) }
}

/** 累计型设置怎么合并（返回合并后的值）；不在这里的按修改时间新的为准 */
const KV_MERGE: Record<string, (a: any, b: any) => any> = {
  ep_progress: (a, b) => {
    const done = { ...(a?.done ?? {}) }
    for (const [k, v] of Object.entries<any>(b?.done ?? {})) {
      const o = done[k]
      done[k] = !o ? v : { date: o.date < v.date ? o.date : v.date, quiz: Math.max(o.quiz ?? 0, v.quiz ?? 0), act: Math.max(o.act ?? -1, v.act ?? -1) < 0 ? null : Math.max(o.act ?? -1, v.act ?? -1), pick: o.pick ?? v.pick, bonus: !!(o.bonus || v.bonus) }
    }
    return { ...a, ...b, done }
  },
  abilities: (a, b) => { const o = { ...(a ?? {}) }; for (const [k, v] of Object.entries<number>(b ?? {})) o[k] = o[k] ? Math.min(o[k], v) : v; return o },
  abilities_seen: (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])],
  eggs_opened: (a, b) => ({ ...(b ?? {}), ...(a ?? {}) }),
  focus_best: (a, b) => { const o = { ...(a ?? {}) }; for (const [k, v] of Object.entries<number>(b ?? {})) o[k] = Math.max(o[k] ?? 0, v); return o },
  pair_stats: (a, b) => { const o = { ...(a ?? {}) }; const n = (x: any) => (x?.listen?.[1] ?? 0) + (x?.speak?.[1] ?? 0); for (const [k, v] of Object.entries<any>(b ?? {})) if (n(v) > n(o[k])) o[k] = v; return o },
  // 浏览器插件划词：按词合并，新的原句为准
  clips: (a, b) => { const o = { ...(a ?? {}) }; for (const [k, v] of Object.entries<any>(b ?? {})) if (!o[k] || (v?.ts ?? 0) > (o[k]?.ts ?? 0)) o[k] = v; return o },
  band_weeks: (a, b) => mergeWeeks(a, b),
  vocab_weeks: (a, b) => mergeWeeks(a, b),
}
function mergeWeeks(a: { week: string }[] | null, b: { week: string }[] | null) {
  const m = new Map((a ?? []).map((x) => [x.week, x]))
  for (const x of b ?? []) if (!m.has(x.week)) m.set(x.week, x)
  return [...m.values()].sort((x, y) => (x.week < y.week ? -1 : 1)).slice(-104)
}

/**
 * 把别的设备的快照合进本机。preferRemote：刚用同步码加入的设备第一次同步，设置一律以已有设备为准
 * （否则新装 App 走引导时存的目标、口音会把老设备的覆盖掉）。返回改了多少条
 */
export async function mergeSnapshot(s: Snapshot, preferRemote = false): Promise<number> {
  const ops: Op[] = []
  // 流水表：并集
  for (const [t, keyOf] of Object.entries(LOGS)) {
    const have = new Set((await db.all<Row>(`SELECT * FROM ${t}`)).map(keyOf))
    for (const r of s.tables[t] ?? []) if (!have.has(keyOf(r))) { have.add(keyOf(r)); ops.push(insert(t, r)) }
  }
  // 词卡：复习得更近的那份为准；加入时间取早的
  const cards = new Map((await db.all<Row>('SELECT * FROM card')).map((r) => [r.word as string, r]))
  for (const r of s.tables.card ?? []) {
    const o = cards.get(r.word as string)
    if (!o) { ops.push(insert('card', r, [])); continue }
    const newer = ((r.last_review as number) ?? 0) > ((o.last_review as number) ?? 0) || (((r.last_review as number) ?? 0) === ((o.last_review as number) ?? 0) && (r.reps as number) > (o.reps as number))
    if (newer) { ops.push({ sql: 'DELETE FROM card WHERE word = ?', params: [r.word] }); ops.push(insert('card', { ...r, added: Math.min(r.added as number, o.added as number) }, [])) }
  }
  // 发音统计：练得多的那份为准
  const ph = new Map((await db.all<Row>('SELECT * FROM phoneme_stat')).map((r) => [r.phone as string, r]))
  for (const r of s.tables.phoneme_stat ?? []) {
    const o = ph.get(r.phone as string)
    if (!o) ops.push(insert('phoneme_stat', r, []))
    else if ((r.n as number) > (o.n as number)) { ops.push({ sql: 'DELETE FROM phoneme_stat WHERE phone = ?', params: [r.phone] }); ops.push(insert('phoneme_stat', r, [])) }
  }
  // 每天的计数：取较大值（同一天两台设备都练了会少算一些，但亮没亮灯不会错）
  const days = new Map((await db.all<Row>('SELECT * FROM day')).map((r) => [r.date as string, r]))
  for (const r of s.tables.day ?? []) {
    const o = days.get(r.date as string)
    if (!o) { ops.push(insert('day', r, [])); continue }
    const up = DAY_COUNTS.filter((k) => ((r[k] as number) ?? 0) > ((o[k] as number) ?? 0))
    if (up.length) ops.push({ sql: `UPDATE day SET ${up.map((k) => `${k} = ?`).join(', ')} WHERE date = ?`, params: [...up.map((k) => r[k]), r.date] })
  }
  // 设置
  const kv = new Map((await db.all<{ key: string; value: string }>('SELECT key, value FROM kv')).map((r) => [r.key, r.value]))
  const kts = new Map((await db.all<{ key: string; ts: number }>('SELECT key, ts FROM kv_ts')).map((r) => [r.key, r.ts]))
  for (const [k, { v, ts }] of Object.entries(s.kv ?? {})) {
    if (isLocalKv(k)) continue
    const mine = kv.get(k)
    let value: string | null = null
    if (mine === undefined) value = v
    else if (KV_MERGE[k]) { const m = JSON.stringify(KV_MERGE[k](JSON.parse(mine), JSON.parse(v))); if (m !== mine) value = m }
    else if (mine !== v && (preferRemote || ts > (kts.get(k) ?? 0))) value = v
    if (value === null) continue
    ops.push({ sql: 'INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', params: [k, value] })
    ops.push({ sql: 'INSERT INTO kv_ts(key, ts) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET ts = excluded.ts', params: [k, Math.max(ts, kts.get(k) ?? 0)] })
  }
  if (ops.length) await db.batch(ops)
  return ops.length
}

// ---------------- 同步流程 ----------------

export type SyncCfg = { code: string; joined: number; pendingFirstPull?: boolean }
export type SyncState = { last: number; error: string | null; devices: number }
export const getSync = () => kvGet<SyncCfg | null>('sync', null)
export const getSyncState = () => kvGet<SyncState>('sync_state', { last: 0, error: null, devices: 0 })

async function deviceId(): Promise<string> {
  let d = await kvGet<string>('sync_device', '')
  if (!d) { d = hex(crypto.getRandomValues(new Uint8Array(16)).buffer); await kvSet('sync_device', d) }
  return d
}

async function req(path: string, init?: RequestInit): Promise<Response> {
  let r: Response
  try { r = await fetch(API + path, init) } catch { throw new Error('连不上同步服务，检查一下网络') }
  if (!r.ok) {
    let msg = `同步服务出错（${r.status}）`
    try { msg = (await r.json()).error ?? msg } catch { /* 不是 JSON */ }
    throw new Error(msg)
  }
  return r
}

let running: Promise<{ pulled: number; changed: number }> | null = null
/**
 * 同步一次：拉别的设备更新过的快照合进来，再把合并后的本机快照传上去。
 * 同一时间只跑一个；没开同步什么都不做
 */
export function syncNow(): Promise<{ pulled: number; changed: number }> {
  return (running ??= (async () => {
    const cfg = await getSync()
    if (!cfg) return { pulled: 0, changed: 0 }
    try {
      const { id, key } = await deriveKeys(cfg.code)
      const dev = await deviceId()
      const seen = await kvGet<Record<string, number>>('sync_seen', {})
      const { devices } = await (await req(`/v1/a/${id}`)).json() as { devices: { dev: string; ts: number }[] }
      let pulled = 0, changed = 0
      for (const d of devices) {
        if (d.dev === dev || (seen[d.dev] ?? 0) >= d.ts) continue
        const blob = new Uint8Array(await (await req(`/v1/a/${id}/d/${d.dev}`)).arrayBuffer())
        changed += await mergeSnapshot(await open<Snapshot>(blob, key), !!cfg.pendingFirstPull)
        seen[d.dev] = d.ts
        pulled++
      }
      const body = await seal(await snapshot(dev), key)
      await req(`/v1/a/${id}/d/${dev}`, { method: 'PUT', body })
      await kvSet('sync_seen', seen)
      if (cfg.pendingFirstPull) await kvSet('sync', { ...cfg, pendingFirstPull: false })
      await kvSet('sync_state', { last: Date.now(), error: null, devices: Math.max(1, devices.filter((d) => d.dev !== dev).length + 1) })
      return { pulled, changed }
    } catch (e) {
      const prev = await getSyncState()
      await kvSet('sync_state', { ...prev, error: (e as Error).message || String(e) })
      throw e
    }
  })().finally(() => { running = null }))
}

/** 开启同步：新建（这台设备是第一台）或用已有的同步码加入 */
export async function enableSync(code?: string): Promise<string> {
  const c = code ? normCode(code).match(/.{1,4}/g)!.join('-') : newCode()
  await kvSet('sync', { code: c, joined: Date.now(), pendingFirstPull: !!code } satisfies SyncCfg)
  await kvSet('sync_seen', {})
  return c
}

/** 这台设备退出同步：删掉服务器上这台设备的快照，本机数据保留 */
export async function disableSync() {
  const cfg = await getSync()
  if (cfg) {
    const { id } = await deriveKeys(cfg.code)
    await req(`/v1/a/${id}/d/${await deviceId()}`, { method: 'DELETE' }).catch(() => {})
  }
  await kvSet('sync', null)
  await kvSet('sync_state', { last: 0, error: null, devices: 0 })
}

/** 自动同步：打开 App、做完练习时调用；两分钟内同步过就跳过。返回合进来多少条（0 = 没变化） */
export async function autoSync(force = false): Promise<number> {
  const cfg = await getSync()
  if (!cfg) return 0
  const st = await getSyncState()
  if (!force && Date.now() - st.last < 120_000) return 0
  try { return (await syncNow()).changed } catch { return 0 /* 错误记在 sync_state，设置页显示 */ }
}
