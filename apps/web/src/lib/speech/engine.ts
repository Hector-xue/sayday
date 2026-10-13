// 发音引擎：网页走 Worker + onnxruntime-web；在安卓 App（Tauri）里走原生插件（快 4~7 倍）
// 两端都只产出音素后验 logits，打分统一在 score.ts，分数口径一致
export type Logits = { logits: Float32Array; T: number; V: number; inferMs: number }

const tauri = (globalThis as any).__TAURI__?.core as { invoke: (cmd: string, args?: object) => Promise<any> } | undefined
export const isNative = !!tauri

const toB64 = (f32: Float32Array) => {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as unknown as number[])
  return btoa(s)
}
const fromB64 = (b64: string) => {
  const s = atob(b64)
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return new Float32Array(u8.buffer)
}

export function normalize(a: Float32Array): Float32Array {
  let m = 0
  for (const x of a) m += x
  m /= a.length
  let v = 0
  for (const x of a) v += (x - m) ** 2
  const sd = Math.sqrt(v / a.length + 1e-7)
  return Float32Array.from(a, (x) => (x - m) / sd)
}

type Status = { state: 'idle' | 'loading' | 'ready' | 'error'; got?: number; total?: number; error?: string }
let status: Status = { state: 'idle' }
const listeners = new Set<(s: Status) => void>()
const setStatus = (s: Status) => { status = s; listeners.forEach((f) => f(s)) }
export const engineStatus = () => status
export function onEngineStatus(f: (s: Status) => void) { listeners.add(f); return () => { listeners.delete(f) } }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (r: Logits) => void; reject: (e: Error) => void }>()
let loading: Promise<void> | null = null

const modelUrl = () => new URL(`models/phone_ctc.int8.onnx?v=${__MODEL_REV__}`, new URL('./', location.href)).href

// ---- 网页：提前在后台把模型下进离线缓存（只下不载入，不占内存），第一次跟读时就不用干等 ----
// 下载走 Service Worker（它边下边存缓存）；没有 Service Worker 时不预下（存不住，白下）
export type ModelCache = { state: 'idle' | 'cached' | 'downloading' | 'error' | 'unsupported'; got?: number; total?: number }
let mc: ModelCache = { state: 'idle' }
const mcListeners = new Set<(s: ModelCache) => void>()
const setMc = (s: ModelCache) => { mc = s; mcListeners.forEach((f) => f(s)) }
export const modelCacheStatus = () => mc
export function onModelCache(f: (s: ModelCache) => void) { mcListeners.add(f); return () => { mcListeners.delete(f) } }
let prefetching: Promise<void> | null = null

/** 模型是不是已经在离线缓存里 */
export async function modelCached(): Promise<boolean> {
  if (isNative) return true
  try { return !!(await caches.match(modelUrl())) } catch { return false }
}

/** 把模型下进缓存。auto：自动触发时，省流量模式下不下（设置里手动点的不管） */
export function prefetchModel(auto = false): Promise<void> {
  if (isNative || status.state === 'ready') return Promise.resolve()
  if (prefetching) return prefetching
  prefetching = (async () => {
    if (await modelCached()) { setMc({ state: 'cached' }); return }
    if (!('serviceWorker' in navigator)) { setMc({ state: 'unsupported' }); return }
    // 第一次打开时 Service Worker 还在装（先缓存外壳），等它接管页面再下，最多等 2 分钟
    if (!navigator.serviceWorker.controller) await new Promise((r) => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 120_000) })
    if (!navigator.serviceWorker.controller) { setMc({ state: 'unsupported' }); return }
    if (await modelCached()) { setMc({ state: 'cached' }); return }
    if (status.state !== 'idle') { setMc({ state: 'idle' }); return } // 等的时候已经开始跟读、引擎自己在下了
    if (auto && (navigator as any).connection?.saveData) return
    setMc({ state: 'downloading', got: 0 })
    const res = await fetch(modelUrl())
    if (!res.ok || !res.body) throw new Error(`模型下载失败（HTTP ${res.status}）`)
    const total = Number(res.headers.get('content-length')) || 0
    const reader = res.body.getReader()
    let got = 0, last = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.length
      if (got - last > 512 * 1024 || got === total) { last = got; setMc({ state: 'downloading', got, total }) }
    }
    // Service Worker 在后台写缓存，等它写完再报“已下好”
    for (let k = 0; k < 40 && !(await modelCached()); k++) await new Promise((r) => setTimeout(r, 250))
    setMc({ state: (await modelCached()) ? 'cached' : 'error' })
  })().catch((e) => { setMc({ state: 'error' }); console.warn('模型预下载失败', e) }).finally(() => { prefetching = null })
  return prefetching
}

/** 准备好推理（网页首次要下载约 120MB 模型，之后走离线缓存） */
export function ensureEngine(): Promise<void> {
  if (loading) return loading
  setStatus({ state: 'loading' })
  if (!tauri && prefetching && mc.state === 'downloading') {
    // 后台正在预下：等它下完（进度照样显示在跟读按钮上），再从缓存载入，不重复下
    const off = onModelCache((m) => { if (m.state === 'downloading') setStatus({ state: 'loading', got: m.got, total: m.total }) })
    setStatus({ state: 'loading', got: mc.got, total: mc.total })
    loading = prefetching.finally(off).then(() => { loading = null; return ensureEngine() })
    loading = loading.catch((e) => { setStatus({ state: 'error', error: String(e?.message || e) }); loading = null; throw e })
    return loading
  }
  if (tauri) {
    loading = tauri.invoke('plugin:sayday-infer|load_model', { threads: 4 }).then(() => setStatus({ state: 'ready' }))
  } else {
    worker = new Worker(new URL('./infer-worker.ts', import.meta.url), { type: 'module' })
    loading = new Promise<void>((resolve, reject) => {
      worker!.onmessage = (e) => {
        const d = e.data
        if (d.type === 'progress') setStatus({ state: 'loading', got: d.got, total: d.total })
        else if (d.type === 'ready') { setStatus({ state: 'ready' }); resolve() }
        else if (d.type === 'result') { pending.get(d.id)?.resolve(d); pending.delete(d.id) }
        else if (d.type === 'error') {
          if (d.id && pending.has(d.id)) { pending.get(d.id)!.reject(new Error(d.error)); pending.delete(d.id) }
          else { setStatus({ state: 'error', error: d.error }); reject(new Error(d.error)) }
        }
      }
      worker!.postMessage({ type: 'load', modelUrl: modelUrl(), wasmBase: new URL('ort/', new URL('./', location.href)).href })
    })
  }
  loading = loading.catch((e) => { setStatus({ state: 'error', error: String(e?.message || e) }); loading = null; throw e })
  return loading
}

export async function infer(audio16k: Float32Array): Promise<Logits> {
  await ensureEngine()
  const x = normalize(audio16k)
  if (tauri) {
    const r = await tauri.invoke('plugin:sayday-infer|run', { audio: toB64(x) })
    return { logits: fromB64(r.logits), T: r.frames, V: r.vocab, inferMs: r.inferMs }
  }
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ type: 'run', id, audio: x }, [x.buffer])
  })
}

// ---- 录音：App 用原生 AudioRecord（语音识别音源，关掉自动增益和降噪）；网页用 MediaRecorder ----
let mediaRec: MediaRecorder | null = null
let chunks: Blob[] = []
// 网页录音时另接一个分析节点读音量（话筒外圈跟着声音跳）；App 里问原生插件
let meter: { ctx: AudioContext; an: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null
const closeMeter = () => { meter?.ctx.close().catch(() => {}); meter = null }

/** 录音中的当前音量（均方根，安静约 0.005，正常说话 0.03~0.2）；没在录就是 0 */
export async function recordLevel(): Promise<number> {
  if (tauri) { try { return (await tauri.invoke('plugin:sayday-infer|record_level'))?.level ?? 0 } catch { return 0 } }
  if (!meter) return 0
  meter.an.getFloatTimeDomainData(meter.buf)
  let s = 0
  for (const v of meter.buf) s += v * v
  return Math.sqrt(s / meter.buf.length)
}

export async function startRecording(): Promise<void> {
  if (tauri) return tauri.invoke('plugin:sayday-infer|record_start')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } })
  mediaRec = new MediaRecorder(stream)
  chunks = []
  mediaRec.ondataavailable = (e) => chunks.push(e.data)
  mediaRec.start()
  try {
    closeMeter()
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const an = ctx.createAnalyser()
    an.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(an)
    meter = { ctx, an, buf: new Float32Array(an.fftSize) }
  } catch { meter = null }
}

export async function stopRecording(): Promise<Float32Array> {
  if (tauri) {
    const r = await tauri.invoke('plugin:sayday-infer|record_stop')
    return fromB64(r.audio)
  }
  const rec = mediaRec!
  closeMeter()
  const blob: Blob = await new Promise((resolve) => {
    rec.onstop = () => { rec.stream.getTracks().forEach((t) => t.stop()); resolve(new Blob(chunks, { type: rec.mimeType })) }
    rec.stop()
  })
  mediaRec = null
  return decodeTo16k(await blob.arrayBuffer())
}

export function cancelRecording() {
  if (tauri) { tauri.invoke('plugin:sayday-infer|record_stop').catch(() => {}); return }
  closeMeter()
  if (mediaRec) { mediaRec.stream.getTracks().forEach((t) => t.stop()); try { mediaRec.stop() } catch {} mediaRec = null }
}

export async function decodeTo16k(buf: ArrayBuffer): Promise<Float32Array> {
  const Ctx = window.AudioContext || (window as any).webkitAudioContext
  const ctx = new Ctx()
  const audio = await ctx.decodeAudioData(buf)
  ctx.close()
  const off = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000)
  const src = off.createBufferSource()
  src.buffer = audio
  src.connect(off.destination)
  src.start()
  return (await off.startRendering()).getChannelData(0)
}
