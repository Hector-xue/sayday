// 离线壳：安装时预缓存完整资源清单（含按需加载的 worker 脚本与 wasm），之后同源 GET 一律缓存优先。
// 只靠“访问过才缓存”不够：多线程推理和 SQLite 的 OPFS 代理是懒加载的，第一次断网时才会被请求。
const CACHE = 'sayday-m0-v4'
const NM = '../node_modules/'
const PRECACHE = [
  './index.html', './app.js', './db-worker.js', './demo.html', './demo.js', './infer-worker.js', './gop.mjs', './calib.mjs',
  NM + 'onnxruntime-web/dist/ort.wasm.min.mjs',
  NM + 'onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
  NM + 'onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
  NM + '@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3-bundler-friendly.mjs',
  NM + '@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm',
  NM + '@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3-opfs-async-proxy.js',
  './models/phone_ctc.int8.onnx', './models/charsiu_vocab.json',
  './tts-worker.js', './tts/samples/index.json',
  './samples/meta.json', './samples/calib.json', './samples/cmudict.min.json',
  ...[0, 1, 2].flatMap((i) => [`./samples/u${i}.f32`, `./samples/u${i}.ref.f32`]),
]

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // 示范音频清单在 index.json 里（由 spikes/tts/gen.mjs 生成）
    const idx = await (await fetch('./tts/samples/index.json', { cache: 'no-cache' })).json()
    const wavs = Object.values(idx).flatMap((v) => ['us', 'gb'].filter((a) => v[a]).map((a) => './tts/samples/' + v[a]))
    // 本版缓存里已有的（页面先下好的模型）跳过；旧版缓存只复用模型这种大文件，页面脚本必须取新的
    for (const u of [...PRECACHE, ...wavs]) {
      const url = new URL(u, self.location.href).href
      if (await cache.match(url)) continue
      const old = url.endsWith('.onnx') ? await caches.match(url) : null
      if (old) await cache.put(url, old)
      else await cache.add(url)
    }
    await self.skipWaiting()
  })())
})
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // 只清自己的旧版本；transformers-cache / kokoro-voices 是语音模型的缓存，不能删
  for (const k of await caches.keys()) if (k.startsWith('sayday-') && k !== CACHE) await caches.delete(k)
  await self.clients.claim()
})()))
self.addEventListener('fetch', (e) => {
  const req = e.request
  const u = new URL(req.url)
  if (req.method !== 'GET' || u.origin !== location.origin) return
  // 自定义句子的语音模型由 transformers.js 自己缓存，这里不再存第二份
  if (u.pathname.includes('/web/tts/onnx-community/')) return
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' })
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  })())
})
