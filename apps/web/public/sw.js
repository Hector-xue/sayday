// 日日说离线外壳：安装时预缓存 precache.json 列出的全部文件（构建时生成）；
// 之后同源 GET 一律缓存优先，没缓存的取网络后存起来（音素模型 122MB 就是这样第一次用到时才缓存）。
// 音素模型地址带 ?v=<模型指纹>，换模型后老用户会重新下载（见 vite.config.ts 的 __MODEL_REV__）。
// 升级：precache.json 的 version 变 → 新缓存名；只清 sayday-app- 前缀的旧缓存（语音模型的缓存不动）。
const PREFIX = 'sayday-app-'

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const m = await (await fetch('./precache.json', { cache: 'no-cache' })).json()
    const cache = await caches.open(PREFIX + m.version)
    for (const f of m.files) {
      const url = new URL(f, self.registration.scope).href
      if (await cache.match(url)) continue
      // 模型文件可从旧版本缓存直接搬（避免升级时重新下载 122MB）
      const old = /\.onnx$/.test(f) ? await caches.match(url) : null
      if (old) await cache.put(url, old)
      else await cache.add(new Request(url, { cache: 'no-cache' }))
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const m = await (await fetch('./precache.json', { cache: 'no-cache' }).catch(() => null))?.json().catch(() => null)
  const keep = m ? PREFIX + m.version : null
  const names = await caches.keys()
  const mine = names.filter((k) => k.startsWith(PREFIX))
  // 把旧版本里运行时才缓存的大文件（模型）搬到新缓存，再删旧缓存
  if (keep) {
    const cur = await caches.open(keep)
    for (const k of mine) if (k !== keep) {
      const c = await caches.open(k)
      for (const req of await c.keys()) if (/\.onnx$/.test(req.url) && !(await cur.match(req))) await cur.put(req, await c.match(req))
      await caches.delete(k)
    }
  }
  await self.clients.claim()
})()))

self.addEventListener('fetch', (e) => {
  const req = e.request
  const u = new URL(req.url)
  if (req.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith(new URL(self.registration.scope).pathname)) return
  // Kokoro 语音模型由 transformers.js 自己缓存；precache.json 每次都要新的
  if (u.pathname.includes('/tts/onnx-community/') || u.pathname.endsWith('/precache.json')) return
  e.respondWith((async () => {
    const names = (await caches.keys()).filter((k) => k.startsWith(PREFIX)).sort().reverse()
    for (const n of names) {
      const hit = await (await caches.open(n)).match(req, { ignoreSearch: req.mode === 'navigate' })
      if (hit) return hit
    }
    if (req.mode === 'navigate' && names.length) {
      const shell = await (await caches.open(names[0])).match(new URL('./index.html', self.registration.scope).href)
      try { return await fetch(req) } catch { if (shell) return shell; throw new Error('offline') }
    }
    const res = await fetch(req)
    if (res.ok && names.length && res.status === 200) {
      // 边下边返回（下载进度照常显示），存缓存在后台进行；副本必须现在就复制，返回后页面就把内容读走了
      const copy = res.clone()
      ;(async () => {
        await (await caches.open(names[0])).put(req, copy)
        // 模型地址带 ?v=<模型指纹>：换了模型就是新地址；新的存好后删掉同一文件的旧版本（122MB 不留两份）
        if (/\.onnx$/.test(u.pathname)) for (const n of names) {
          const c = await caches.open(n)
          for (const k of await c.keys()) { const ku = new URL(k.url); if (ku.pathname === u.pathname && ku.search !== u.search) await c.delete(k) }
        }
      })().catch((err) => console.warn('模型缓存失败', err))
    }
    return res
  })())
})
