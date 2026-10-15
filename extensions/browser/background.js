// 后台：词表放这里（页面里每次都载 2MB 太浪费），回答内容脚本的查词；收了词就同步一次（填了同步码的话）
import { lookup, snapshotOf } from './lib.js'
import { deriveKeys, seal } from './crypto.js'

const API = 'https://sayday.ivyea.com/api/sync'
let words = null
const loadWords = async () => (words ??= await (await fetch(chrome.runtime.getURL('words.json'))).json())

async function sync() {
  const { code, dev, clips = {} } = await chrome.storage.local.get(['code', 'dev', 'clips'])
  if (!code) return { ok: false, error: '还没填同步码' }
  let d = dev
  if (!d) { d = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join(''); await chrome.storage.local.set({ dev: d }) }
  const { id, key } = await deriveKeys(code)
  const r = await fetch(`${API}/v1/a/${id}/d/${d}`, { method: 'PUT', body: await seal(snapshotOf(d, clips), key) })
  if (!r.ok) { let m = `同步出错（${r.status}）`; try { m = (await r.json()).error ?? m } catch {} await chrome.storage.local.set({ last: { ts: Date.now(), error: m } }); return { ok: false, error: m } }
  await chrome.storage.local.set({ last: { ts: Date.now(), error: null } })
  return { ok: true }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'lookup') return reply(lookup(await loadWords(), msg.word))
    if (msg.type === 'save') {
      const { clips = {} } = await chrome.storage.local.get('clips')
      clips[msg.word] = { s: msg.s, url: msg.url, title: msg.title, ts: Date.now() }
      await chrome.storage.local.set({ clips })
      reply({ ok: true, n: Object.keys(clips).length })
      sync().catch(() => {})
      return
    }
    if (msg.type === 'has') { const { clips = {} } = await chrome.storage.local.get('clips'); return reply(!!clips[msg.word]) }
    if (msg.type === 'sync') return reply(await sync())
  })()
  return true
})
