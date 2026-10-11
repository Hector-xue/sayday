// 自然人声合成 Worker（Kokoro-82M，kokoro-js）：只在“自定义句子”听示范时按需载入，预置句子直接播预生成音频。
// 模型 / 音色 / wasm 全部从本站取（国内连不上 Hugging Face），并跟随本站离线缓存。
import { KokoroTTS, env } from '../node_modules/kokoro-js/dist/kokoro.web.js'

const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/'
const LOCAL = new URL('./tts/onnx-community/Kokoro-82M-v1.0-ONNX/', self.location.href).href
const realFetch = self.fetch.bind(self)
self.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  return realFetch(url.startsWith(HF) ? LOCAL + url.slice(HF.length) : input, init)
}
env.wasmPaths = new URL('../node_modules/kokoro-js/ort/', self.location.href).href

let tts = null
async function load() {
  if (tts) return
  const t0 = performance.now()
  tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => { if (p.status === 'progress' && p.file?.endsWith('.onnx')) self.postMessage({ type: 'progress', got: p.loaded, total: p.total }) },
  })
  self.postMessage({ type: 'ready', loadMs: Math.round(performance.now() - t0) })
}

self.onmessage = async (e) => {
  const { type, id, text, voice } = e.data
  try {
    if (type === 'load') await load()
    else if (type === 'speak') {
      await load()
      const t0 = performance.now()
      const a = await tts.generate(text, { voice, speed: 0.95 })
      self.postMessage({ type: 'audio', id, audio: a.audio, rate: a.sampling_rate, ms: Math.round(performance.now() - t0) }, [a.audio.buffer])
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String((err && err.stack) || err) })
  }
}
