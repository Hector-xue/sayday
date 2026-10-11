// 离线壳：安装时预缓存完整资源清单（含按需加载的 worker 脚本与 wasm），之后同源 GET 一律缓存优先。
// 只靠“访问过才缓存”不够：多线程推理和 SQLite 的 OPFS 代理是懒加载的，第一次断网时才会被请求。
const CACHE = 'sayday-m0-v2'
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
  './samples/meta.json', './samples/calib.json', './samples/cmudict.min.json',
  ...[0, 1, 2].flatMap((i) => [`./samples/u${i}.f32`, `./samples/u${i}.ref.f32`]),
]

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(PRECACHE)
    await self.skipWaiting()
  })())
})
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
  await self.clients.claim()
})()))
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' })
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  })())
})
