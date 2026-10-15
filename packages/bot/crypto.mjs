// 和 App 里 apps/web/src/lib/sync.ts 同一套：同步码 → 账号 id + AES-GCM 密钥；数据块 [版本 1][标志 1=gzip][iv 12][密文]
// 改这里要同时改那边（apps/web/src/lib/__tests__/bot-compat.test.ts 会检查两边算出来一样）
const enc = new TextEncoder()
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha = (s) => crypto.subtle.digest('SHA-256', enc.encode(s))

export const normCode = (s) => String(s).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
export const validCode = (s) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(normCode(s))

export async function deriveKeys(code, scope = 'sync') {
  const base = `sayday-${scope}-v1:${normCode(code)}`
  const id = hex(await sha(base + ':id')).slice(0, 40)
  const key = await crypto.subtle.importKey('raw', await sha(base + ':key'), 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { id, key }
}

async function pipe(data, t) { return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(t)).arrayBuffer()) }

export async function seal(obj, key) {
  const plain = await pipe(enc.encode(JSON.stringify(obj)), new CompressionStream('gzip'))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  const out = new Uint8Array(14 + ct.length)
  out[0] = 1; out[1] = 1; out.set(iv, 2); out.set(ct, 14)
  return out
}

export async function open(blob, key) {
  if (blob[0] !== 1) throw new Error('数据版本不认识')
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(2, 14) }, key, blob.slice(14)))
  if (blob[1] & 1) plain = await pipe(plain, new DecompressionStream('gzip'))
  return JSON.parse(new TextDecoder().decode(plain))
}
