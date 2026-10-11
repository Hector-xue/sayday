// 推理 Worker：模型加载 + 音素后验 + GOP，全部不占主线程
import * as ort from '../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
import { prepare, afGop } from './gop.mjs'

const V = 42
let session = null
let vocab = null

async function load(modelUrl) {
  ort.env.wasm.wasmPaths = new URL('../node_modules/onnxruntime-web/dist/', self.location.href).href
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
  vocab = await (await fetch('./models/charsiu_vocab.json')).json()
  const res = await fetch(modelUrl)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    self.postMessage({ type: 'progress', got, total })
  }
  const buf = new Uint8Array(got)
  let o = 0
  for (const c of chunks) { buf.set(c, o); o += c.length }
  const t0 = performance.now()
  session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  self.postMessage({ type: 'ready', createMs: Math.round(performance.now() - t0), threads: ort.env.wasm.numThreads })
}

async function score(audio, phones) {
  // 零均值单位方差归一化（与评测时一致）
  let m = 0
  for (const x of audio) m += x
  m /= audio.length
  let v = 0
  for (const x of audio) v += (x - m) ** 2
  const sd = Math.sqrt(v / audio.length + 1e-7)
  const x = new Float32Array(audio.length)
  for (let i = 0; i < audio.length; i++) x[i] = (audio[i] - m) / sd

  const t0 = performance.now()
  const out = await session.run({ input_values: new ort.Tensor('float32', x, [1, x.length]) })
  const inferMs = performance.now() - t0
  const T = out.logits.dims[1]
  const t1 = performance.now()
  const lp = prepare(out.logits.data, T, V)
  const seq = phones.map((p) => vocab[p])
  const phoneIds = Object.entries(vocab).filter(([k]) => !k.startsWith('[')).map(([, id]) => id)
  const gop = afGop(lp, T, V, seq, phoneIds)
  const gopMs = performance.now() - t1
  return { gop: Array.from(gop), inferMs: Math.round(inferMs), gopMs: Math.round(gopMs), audioS: +(audio.length / 16000).toFixed(2) }
}

self.onmessage = async (e) => {
  const { type, id } = e.data
  try {
    if (type === 'load') await load(e.data.modelUrl)
    else if (type === 'score') self.postMessage({ type: 'scored', id, ...(await score(e.data.audio, e.data.phones)) })
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String(err && err.stack || err) })
  }
}
