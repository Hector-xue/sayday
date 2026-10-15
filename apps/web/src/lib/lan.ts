// 面对面同步：两台设备连同一个 Wi-Fi，一台“出码”，另一台扫码（或手动输入地址和配对码），
// 学习记录直接在两台之间一来一回交换、各自合并。不经过任何服务器，没有账号。
//
// 收发在原生那边（apps/native/src-tauri/src/lan.rs，裸 TCP）；这里管配对码、加密、快照和合并。
// 配对码只在这一次有效：PBKDF2 派生出 AES-GCM 密钥（加密快照）和一个 tag（挡掉同一网络里乱连的）。
import { kvGet, kvSet } from './db'
import { deviceId, mergeSnapshot, open, seal, snapshot, type Snapshot } from './sync'

type Invoke = (cmd: string, args?: object) => Promise<any>
const invoke = (): Invoke | undefined => (globalThis as any).__TAURI_INTERNALS__?.invoke
/** 网页版不能用（浏览器开不了端口、也连不了局域网里的设备），只有 App 能 */
export const canLan = () => !!invoke()

export const LAN_PORT = 47231
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 配对码：10 个字符（50 位），4-4-2 分组 */
export function newPairCode(rnd: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = rnd(10)
  let out = ''
  for (let i = 0; i < 10; i++) out += B32[b[i] & 31]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`
}
export const normPair = (s: string) => s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
export const validPair = (s: string) => /^[0-9A-HJKMNP-TV-Z]{10}$/.test(normPair(s))

export type Session = { addrs: string[]; port: number; code: string }
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

/** 二维码里的内容 */
export const sessionText = (s: Session) => `SAYDAY1;${s.addrs.join(',')};${s.port};${normPair(s.code)}`
export function parseSessionText(t: string): Session | null {
  const m = t.trim().match(/^SAYDAY1;([\d.,]+);(\d+);([0-9A-Z]+)$/)
  if (!m) return null
  const addrs = m[1].split(',').filter((a) => IPV4.test(a))
  const port = Number(m[2])
  if (!addrs.length || !(port > 0 && port < 65536) || !validPair(m[3])) return null
  return { addrs, port, code: normPair(m[3]) }
}
/** 手动输入：地址可以带端口（192.168.1.5:50123），不带就是默认端口 */
export function parseManual(addr: string, code: string): Session | null {
  const m = addr.trim().replace(/[：。]/g, (c) => (c === '：' ? ':' : '.')).match(/^([\d.]+)(?::(\d+))?$/)
  if (!m || !IPV4.test(m[1]) || !validPair(code)) return null
  const port = m[2] ? Number(m[2]) : LAN_PORT
  if (!(port > 0 && port < 65536)) return null
  return { addrs: [m[1]], port, code: normPair(code) }
}
/** 给人看的地址：默认端口就不写 */
export const showAddr = (s: Session) => (s.port === LAN_PORT ? s.addrs[0] : `${s.addrs[0]}:${s.port}`)

/** 局域网地址排前面（192.168 / 10 / 172.16-31），最多留 4 个 */
export function rankAddrs(list: string[]): string[] {
  const priv = (a: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
  return [...new Set(list.filter((a) => IPV4.test(a) && !a.startsWith('127.')))].sort((a, b) => Number(priv(b)) - Number(priv(a))).slice(0, 4)
}

export type PairKeys = { key: CryptoKey; tag: string }
export async function pairKeys(code: string): Promise<PairKeys> {
  const enc = new TextEncoder()
  const base = await crypto.subtle.importKey('raw', enc.encode(normPair(code)), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('sayday-lan-v1'), iterations: 100_000 }, base, 384))
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const tag = [...bits.slice(32)].map((x) => x.toString(16).padStart(2, '0')).join('')
  return { key, tag }
}

export function toB64(u8: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as unknown as number[])
  return btoa(bin)
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

/** 原生那边的报错是中文字符串；连不上时补一句最常见的原因 */
function explain(e: unknown): Error {
  const m = String((e as Error)?.message ?? e)
  if (/连不上/.test(m)) return new Error('连不上另一台设备。确认两台连的是同一个 Wi-Fi（访客网络、公司网络有时不让设备互连，可以让一台开热点、另一台连上），另一台还停在出码的页面')
  return new Error(m || '传输出错了')
}

/** 我的快照。fresh = 新装还没建档的设备：什么都不交出去，免得它刚写的默认设置盖掉老设备的 */
async function mySnapshot(fresh: boolean): Promise<Snapshot> {
  const dev = await deviceId()
  return fresh ? { v: 1, dev, ts: Date.now(), tables: {}, kv: {} } : snapshot(dev)
}

export type LanResult = { changed: number }
async function finish(payload: string, keys: PairKeys, preferRemote: boolean): Promise<LanResult> {
  let s: Snapshot
  try { s = await open<Snapshot>(fromB64(payload), keys.key) } catch { throw new Error('解不开对方传来的记录，配对码不对或者两边版本差太多（先都更新到最新版）') }
  const changed = await mergeSnapshot(s, preferRemote)
  await kvSet('sync_lan_last', Date.now())
  return { changed }
}
export const lastLanSync = () => kvGet<number>('sync_lan_last', 0)

/** 出码：开端口等另一台连过来，返回二维码要显示的会话 */
export async function startHost(): Promise<{ session: Session; keys: PairKeys }> {
  const inv = invoke()
  if (!inv) throw new Error('网页版不能面对面同步，请用 App')
  const code = newPairCode()
  const keys = await pairKeys(code)
  const payload = toB64(await seal(await mySnapshot(false), keys.key))
  let port: number, rust: string[]
  try { [port, rust] = await inv('lan_host', { payload, tag: keys.tag }) } catch (e) { throw explain(e) }
  // 安卓自己列网卡（开热点时只有它准）；旧版安装包没有这个命令就算了
  const android: string[] = await inv('plugin:sayday-infer|lan_addrs').then((r: any) => r?.addrs ?? []).catch(() => [])
  const addrs = rankAddrs([...android, ...rust])
  if (!addrs.length) { await stopHost(); throw new Error('这台设备好像没连 Wi-Fi。连上 Wi-Fi（或者开热点让另一台连上）再试') }
  return { session: { addrs, port, code }, keys }
}
/** 出码这边：null = 还在等；对方连上后合并并返回结果 */
export async function pollHost(keys: PairKeys): Promise<LanResult | null> {
  let p: string | null
  try { p = await invoke()!('lan_poll') } catch (e) { throw explain(e) }
  return p == null ? null : finish(p, keys, false)
}
export async function stopHost() { await invoke()?.('lan_stop').catch(() => {}) }

/** 扫码这边：连过去交换。fresh = 新设备第一次接（设置以老设备为准） */
export async function joinHost(s: Session, fresh = false): Promise<LanResult> {
  const inv = invoke()
  if (!inv) throw new Error('网页版不能面对面同步，请用 App')
  const keys = await pairKeys(s.code)
  const payload = toB64(await seal(await mySnapshot(fresh), keys.key))
  let theirs: string
  try { theirs = await inv('lan_send', { addrs: s.addrs, port: s.port, tag: keys.tag, payload }) } catch (e) { throw explain(e) }
  return finish(theirs, keys, fresh)
}
