import * as ort from '../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'

const out = document.getElementById('out')
const log = (o) => {
  const runs = o.model?.runs || []
  const rtf = runs.length ? runs.reduce((a, r) => a + r.inferMs / 1000 / r.audioS, 0) / runs.length : null
  const head = [
    `设备：${navigator.userAgent}`,
    `CPU 核数：${navigator.hardwareConcurrency || '未知'}`,
    rtf === null ? '推理：未完成' : `推理：每 1 秒音频约 ${rtf.toFixed(2)} 秒（3 秒的句子约 ${(3 * rtf).toFixed(1)} 秒）`,
    o.model ? `模型载入 ${o.model.fetchMs} ms，建会话 ${o.model.createMs} ms` : '',
    o.db ? (o.db.ok ? `本地数据库：写入 1 万条 ${o.db.insert10kMs} ms，累计 ${o.db.after} 条（刷新后应继续增加）` : `本地数据库出错：${o.db.error}`) : '',
    `离线缓存：${o.swControlled ? '已接管（可断网刷新）' : '首次打开，刷新一次后生效'}`,
    o.error ? `出错：${o.error}` : '',
  ].filter(Boolean).join('\n')
  out.textContent = head + '\n\n' + JSON.stringify(o, null, 1)
}

async function runDb() {
  const w = new Worker('./db-worker.js', { type: 'module' })
  const r = await new Promise((res) => { w.onmessage = (e) => res(e.data); w.postMessage('go') })
  w.terminate()
  return r
}

async function f32(url) { return new Float32Array(await (await fetch(url)).arrayBuffer()) }

async function runModel(name) {
  ort.env.wasm.wasmPaths = new URL('../node_modules/onnxruntime-web/dist/', location.href).href
  ort.env.wasm.numThreads = self.crossOriginIsolated ? 2 : 1
  const t0 = performance.now()
  const buf = await (await fetch(`./models/phone_ctc.${name}.onnx`)).arrayBuffer()
  const tFetch = performance.now() - t0
  const sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  const tCreate = performance.now() - t0 - tFetch
  const meta = await (await fetch('./samples/meta.json')).json()
  const runs = []
  for (const m of meta) {
    const x = await f32(`./samples/u${m.i}.f32`)
    const ref = await f32(`./samples/u${m.i}.ref.f32`)
    // 先跑一次热身，再计时
    if (m.i === 0) await sess.run({ input_values: new ort.Tensor('float32', x, [1, x.length]) })
    const t = performance.now()
    const o = await sess.run({ input_values: new ort.Tensor('float32', x, [1, x.length]) })
    const ms = performance.now() - t
    const lg = o.logits.data
    let maxDiff = 0, argmaxAgree = 0
    const V = m.vocab, T = m.frames
    for (let f = 0; f < T; f++) {
      let a = 0, b = 0
      for (let v = 0; v < V; v++) {
        maxDiff = Math.max(maxDiff, Math.abs(lg[f * V + v] - ref[f * V + v]))
        if (lg[f * V + v] > lg[f * V + a]) a = v
        if (ref[f * V + v] > ref[f * V + b]) b = v
      }
      if (a === b) argmaxAgree++
    }
    runs.push({ text: m.text, audioS: +(m.samples / 16000).toFixed(2), inferMs: Math.round(ms), maxAbsDiffVsPython: +maxDiff.toFixed(4), argmaxAgree: +(argmaxAgree / T).toFixed(4) })
  }
  return { model: name, threads: ort.env.wasm.numThreads, crossOriginIsolated: self.crossOriginIsolated, fetchMs: Math.round(tFetch), createMs: Math.round(tCreate), runs }
}

;(async () => {
  const res = { online: navigator.onLine, swControlled: !!navigator.serviceWorker?.controller }
  try {
    await navigator.serviceWorker.register('./sw.js')
    await navigator.serviceWorker.ready
    res.db = await runDb()
    res.model = await runModel(new URLSearchParams(location.search).get('m') || 'int8')
  } catch (e) {
    res.error = String(e && e.stack || e)
  }
  window.__result = res
  log(res)
})()
