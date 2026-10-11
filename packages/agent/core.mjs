// 日日说给 AI 助手用的核心能力（Node）：音频解码 → 音素打分 / 语音识别，词典、例句、题库查询
// 打分、识别和 App 是同一套代码（packages/speech、packages/asr），分数口径一致
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import * as ort from 'onnxruntime-node'
import { decode as silkDecode } from 'silk-wasm'
import { scoreWith, phoneIdsOf, normalize, tokenize, dictWord } from '../speech/score.mjs'
import { transcribe as moonshine } from '../asr/moonshine.mjs'

const ROOT = new URL('../../', import.meta.url).pathname
// 模型目录：默认仓库的 .cache/models（scripts 里的导出 / 下载脚本放的位置），可用 SAYDAY_MODELS 改
const MODELS = process.env.SAYDAY_MODELS || join(ROOT, '.cache/models')
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))

// ---------- 内容 ----------
let content = null
export function getContent() {
  if (content) return content
  const words = json(join(ROOT, 'content/pack/words.json')).map((x) => ({ w: x[0], rank: x[1], cefr: x[2], ipa: x[3], zh: x[4], tags: x[5] ? String(x[5]).split(' ') : [], sensitive: x[7] === 1 }))
  const sents = json(join(ROOT, 'content/pack/sentences.json')).map((x) => ({ id: x[0], en: x[1], zh: x[2], hard: x[3], cefr: x[4], words: x[5] }))
  const byWord = new Map(words.map((w) => [w.w, w]))
  const sentsByWord = new Map()
  for (const s of sents) for (const t of s.words) (sentsByWord.get(t) ?? sentsByWord.set(t, []).get(t)).push(s)
  content = { words, sents, byWord, sentsByWord, episodes: json(join(ROOT, 'content/episodes/s1.json')), ielts: json(join(ROOT, 'content/ielts/speaking.json')) }
  return content
}

// ---------- 音频 ----------
/** 接受三种来源：http(s) 链接、本机路径、base64（可带 data: 前缀）。返回 Buffer */
export async function readAudio(src) {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src)
    if (!r.ok) throw new Error(`下载音频失败：HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  if (src.length < 4096 && existsSync(src)) return readFileSync(src)
  const b64 = src.replace(/^data:[^,]*,/, '')
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64.slice(0, 200))) throw new Error('audio 既不是链接、文件路径，也不是 base64')
  return Buffer.from(b64, 'base64')
}

function wavTo16k(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let o = 12, fmt = null, data = null
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4), size = buf.readUInt32LE(o + 4)
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(o + 8), ch: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) }
    if (id === 'data') data = buf.subarray(o + 8, o + 8 + size)
    o += 8 + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('WAV 文件不完整')
  const n = Math.floor(data.length / (fmt.bits / 8) / fmt.ch)
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let c = 0; c < fmt.ch; c++) {
      const p = (i * fmt.ch + c) * (fmt.bits / 8)
      s += fmt.tag === 3 ? data.readFloatLE(p) : fmt.bits === 16 ? data.readInt16LE(p) / 32768 : fmt.bits === 8 ? (data[p] - 128) / 128 : data.readInt32LE(p) / 2147483648
    }
    mono[i] = s / fmt.ch
  }
  return resample(mono, fmt.rate)
}

/** 简单的抗混叠重采样：先按比例做滑动平均低通，再线性插值 */
export function resample(x, from, to = 16000) {
  if (from === to) return x
  const r = from / to
  let y = x
  if (r > 1) {
    const w = Math.max(1, Math.round(r))
    y = new Float32Array(x.length)
    let acc = 0
    for (let i = 0; i < x.length; i++) { acc += x[i]; if (i >= w) acc -= x[i - w]; y[i] = acc / Math.min(i + 1, w) }
  }
  const n = Math.floor(x.length / r)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) { const p = i * r, j = Math.floor(p), t = p - j; out[i] = y[j] * (1 - t) + (y[j + 1] ?? y[j]) * t }
  return out
}

/** 任意音频 → 16kHz 单声道 float32。WAV 自己解，微信 silk 用 silk-wasm，其他格式要本机有 ffmpeg */
export async function decodeAudio(buf) {
  const w = wavTo16k(buf)
  if (w) return w
  const head = buf.toString('latin1', 0, 10)
  if (head.includes('#!SILK')) {
    const d = await silkDecode(buf, 24000)
    const pcm = new Int16Array(d.data.buffer, d.data.byteOffset, d.data.byteLength / 2)
    return resample(Float32Array.from(pcm, (v) => v / 32768), 24000)
  }
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { input: buf, maxBuffer: 1 << 28 })
  if (r.error) throw new Error('这种音频格式需要本机装 ffmpeg 才能解码（WAV 和微信 silk 不需要）')
  if (r.status !== 0) throw new Error('音频解码失败：' + String(r.stderr).slice(0, 200))
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4).slice()
}

// ---------- 模型 ----------
let phone = null, asr = null
async function phoneModel() {
  if (phone) return phone
  const p = join(MODELS, 'phone_ctc.int8.onnx')
  if (!existsSync(p)) throw new Error(`没找到音素模型 ${p}：用 spikes/m0/export_onnx.py 导出，或设 SAYDAY_MODELS 指到放模型的目录`)
  const sess = await ort.InferenceSession.create(p, { graphOptimizationLevel: 'all' })
  const vocab = json(join(MODELS, 'charsiu_vocab.json'))
  phone = { sess, assets: { dict: json(join(ROOT, 'packages/speech/cmudict.min.json')), vocab, calib: json(join(ROOT, 'packages/speech/calib.json')), phoneIds: phoneIdsOf(vocab) } }
  return phone
}
async function asrModel() {
  if (asr) return asr
  const d = join(MODELS, 'asr/moonshine-base')
  if (!existsSync(join(d, 'vocab.json'))) throw new Error(`没找到识别模型 ${d}：运行 scripts/fetch-asr-model.sh`)
  asr = {
    enc: await ort.InferenceSession.create(join(d, 'onnx/encoder_model_quantized.onnx')),
    dec: await ort.InferenceSession.create(join(d, 'onnx/decoder_model_merged_quantized.onnx')),
    vocab: json(join(d, 'vocab.json')),
  }
  return asr
}

export async function transcribe(audio) {
  const m = await asrModel()
  // 一段 20 秒以内效果最好；更长的按 20 秒硬切（服务端只做兜底，App 里会按静音切）
  const out = []
  for (let s = 0; s < audio.length; s += 16000 * 20) out.push(await moonshine(ort, m.enc, m.dec, audio.subarray(s, Math.min(audio.length, s + 16000 * 20)), m.vocab))
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

export async function scoreAudio(audio, text) {
  const m = await phoneModel()
  const x = normalize(audio)
  const out = await m.sess.run({ input_values: new ort.Tensor('float32', x, [1, x.length]) })
  const [, T, V] = out.logits.dims
  return scoreWith(m.assets, text, { logits: out.logits.data, T, V })
}

export { tokenize, dictWord }
