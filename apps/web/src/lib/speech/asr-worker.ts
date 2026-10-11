// 离线语音识别 Worker（Moonshine base，int8，约 63MB）：首次用到时下载，存进 Cache Storage，之后断网也能用
// 推理用和发音打分同一个 onnxruntime-web（单线程 wasm）；解码逻辑在 packages/asr（Node 上和 transformers.js 逐字对拍过）
import * as ort from 'onnxruntime-web/wasm'
import { transcribe } from '@asr/moonshine.mjs'

const CACHE = 'sayday-asr-v1'
let enc: ort.InferenceSession | null = null
let dec: ort.InferenceSession | null = null
let vocab: string[] = []

async function fetchCached(url: string, onBytes: (n: number, total: number) => void): Promise<Uint8Array> {
  const cache = await caches.open(CACHE).catch(() => null)
  const hit = await cache?.match(url)
  if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); onBytes(b.length, b.length); return b }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`识别模型下载失败（HTTP ${res.status}）`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value); got += value.length
    onBytes(got, total)
  }
  const buf = new Uint8Array(got)
  let o = 0
  for (const c of chunks) { buf.set(c, o); o += c.length }
  await cache?.put(url, new Response(buf)).catch(() => {})
  return buf
}

async function load(base: string, wasmBase: string) {
  ort.env.wasm.wasmPaths = wasmBase
  ort.env.wasm.numThreads = 1
  // 两个文件的进度合起来报（大小大约 20MB + 42MB）
  const sizes = { e: 20_500_000, d: 42_500_000 }
  const got = { e: 0, d: 0 }
  const report = () => self.postMessage({ type: 'progress', got: got.e + got.d, total: sizes.e + sizes.d })
  const [v, e, d] = await Promise.all([
    fetch(base + 'vocab.json').then((r) => { if (!r.ok) throw new Error(`识别词表下载失败（HTTP ${r.status}）`); return r.json() }),
    fetchCached(base + 'encoder.onnx', (n, t) => { got.e = n; if (t) sizes.e = t; report() }),
    fetchCached(base + 'decoder.onnx', (n, t) => { got.d = n; if (t) sizes.d = t; report() }),
  ])
  vocab = v
  const opt: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
  enc = await ort.InferenceSession.create(e, opt)
  dec = await ort.InferenceSession.create(d, opt)
  self.postMessage({ type: 'ready' })
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id } = e.data
  try {
    if (type === 'load') await load(e.data.base, e.data.wasmBase)
    else if (type === 'run') {
      const t0 = performance.now()
      const text = await transcribe(ort, enc, dec, e.data.audio as Float32Array, vocab)
      self.postMessage({ type: 'result', id, text, ms: Math.round(performance.now() - t0) })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String((err as Error)?.message || err) })
  }
}
