// 自然人声合成 Worker（Kokoro-82M / kokoro-js）。模型、音色、wasm 都从本站 tts/ 取（国内连不上 Hugging Face）。
// kokoro.web.js 放在 public/tts/lib，运行时动态导入，不进打包。
// 站点根由主线程传进来（Worker 自己的位置在开发和打包时不一样）
let base = ''
const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/'
const realFetch = self.fetch.bind(self)
self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return realFetch(url.startsWith(HF) ? new URL('tts/onnx-community/Kokoro-82M-v1.0-ONNX/', base).href + url.slice(HF.length) : input, init)
}) as typeof fetch

let tts: any = null
async function load() {
  if (tts) return
  const mod: any = await import(/* @vite-ignore */ new URL('tts/lib/kokoro.web.js', base).href)
  mod.env.wasmPaths = new URL('tts/ort/', base).href
  tts = await mod.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: any) => { if (p.status === 'progress' && p.file?.endsWith('.onnx')) self.postMessage({ type: 'progress', got: p.loaded, total: p.total }) },
  })
}

self.onmessage = async (e: MessageEvent) => {
  const { id, text, voice } = e.data
  base = e.data.base
  try {
    await load()
    const a = await tts.generate(text, { voice, speed: 0.95 })
    self.postMessage({ type: 'audio', id, audio: a.audio, rate: a.sampling_rate }, { transfer: [a.audio.buffer] })
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String((err as Error)?.message || err) })
  }
}
