// 网页端音素识别 Worker：onnxruntime-web（单线程 WASM，M0 实测多线程在离线时会卡死）
import * as ort from 'onnxruntime-web/wasm'

let session: ort.InferenceSession | null = null

async function load(modelUrl: string, wasmBase: string) {
  ort.env.wasm.wasmPaths = wasmBase
  ort.env.wasm.numThreads = 1
  const res = await fetch(modelUrl)
  if (!res.ok) throw new Error(`模型下载失败（HTTP ${res.status}）`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
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
  session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  self.postMessage({ type: 'ready' })
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id } = e.data
  try {
    if (type === 'load') await load(e.data.modelUrl, e.data.wasmBase)
    else if (type === 'run') {
      const x: Float32Array = e.data.audio
      const t0 = performance.now()
      const out = await session!.run({ input_values: new ort.Tensor('float32', x, [1, x.length]) })
      const logits = out.logits.data as Float32Array
      const [, T, V] = out.logits.dims as number[]
      self.postMessage({ type: 'result', id, logits, T, V, inferMs: Math.round(performance.now() - t0) }, { transfer: [logits.buffer] })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String((err as Error)?.message || err) })
  }
}
