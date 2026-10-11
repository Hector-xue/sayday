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

/** 准备好推理（网页首次要下载约 120MB 模型，之后走离线缓存） */
export function ensureEngine(): Promise<void> {
  if (loading) return loading
  setStatus({ state: 'loading' })
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
      const base = new URL('./', location.href)
      worker!.postMessage({ type: 'load', modelUrl: new URL('models/phone_ctc.int8.onnx', base).href, wasmBase: new URL('ort/', base).href })
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

export async function startRecording(): Promise<void> {
  if (tauri) return tauri.invoke('plugin:sayday-infer|record_start')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } })
  mediaRec = new MediaRecorder(stream)
  chunks = []
  mediaRec.ondataavailable = (e) => chunks.push(e.data)
  mediaRec.start()
}

export async function stopRecording(): Promise<Float32Array> {
  if (tauri) {
    const r = await tauri.invoke('plugin:sayday-infer|record_stop')
    return fromB64(r.audio)
  }
  const rec = mediaRec!
  const blob: Blob = await new Promise((resolve) => {
    rec.onstop = () => { rec.stream.getTracks().forEach((t) => t.stop()); resolve(new Blob(chunks, { type: rec.mimeType })) }
    rec.stop()
  })
  mediaRec = null
  return decodeTo16k(await blob.arrayBuffer())
}

export function cancelRecording() {
  if (tauri) { tauri.invoke('plugin:sayday-infer|record_stop').catch(() => {}); return }
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
