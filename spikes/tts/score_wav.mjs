// 用日日说自己的发音评分（同 web 端 gop.mjs / calib.mjs）给示范音频打分：示范应接近满分、无尾音报警。
// 用法: node score_wav.mjs <index.json 所在目录>
import * as ort from 'onnxruntime-node'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepare, afGop, tailLLR } from '../m0/web/gop.mjs'
import { calibrate, tailPositions, uttScore, VOWELS } from '../m0/web/calib.mjs'

const dir = process.argv[2]
const web = new URL('../m0/web/', import.meta.url)
const vocab = JSON.parse(readFileSync(new URL('models/charsiu_vocab.json', web)))
const calib = JSON.parse(readFileSync(new URL('samples/calib.json', web)))
const dict = JSON.parse(readFileSync(new URL('samples/cmudict.min.json', web)))
const V = 42
const phoneIds = Object.entries(vocab).filter(([k]) => !k.startsWith('[')).map(([, id]) => id)
const sess = await ort.InferenceSession.create(new URL('models/phone_ctc.int8.onnx', web).pathname)

function readWav(p) {
  const b = readFileSync(p)
  const rate = b.readUInt32LE(24)
  const n = b.readUInt32LE(40) / 2
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768
  return { x, rate }
}

// 窗函数 sinc 重采样到 16k（截止取两者奈奎斯特较小者）
function resample(x, from, to = 16000) {
  if (from === to) return x
  const ratio = from / to, fc = Math.min(1, to / from) * 0.95, W = 16
  const out = new Float32Array(Math.floor(x.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const c = i * ratio
    let s = 0
    for (let j = Math.ceil(c - W); j <= Math.floor(c + W); j++) {
      if (j < 0 || j >= x.length) continue
      const d = j - c
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * fc * d) / (Math.PI * fc * d)
      s += x[j] * fc * sinc * (0.5 + 0.5 * Math.cos((Math.PI * d) / W))
    }
    out[i] = s
  }
  return out
}

const index = JSON.parse(readFileSync(join(dir, 'index.json')))
for (const item of Object.values(index)) {
  const words = (item.text.match(/[A-Za-z']+/g) || []).map((w) => w.toLowerCase()).filter((w) => dict[w]).map((w) => ({ word: w, phones: dict[w].split(' ') }))
  const phones = words.flatMap((w) => w.phones)
  const seq = phones.map((p) => vocab[p])
  const tp = tailPositions(words)
  for (const accent of ['us', 'gb']) {
    if (!item[accent]) continue
    const { x: raw, rate } = readWav(join(dir, item[accent]))
    const a = resample(raw, rate)
    let m = 0; for (const v of a) m += v; m /= a.length
    let s = 0; for (const v of a) s += (v - m) ** 2
    const sd = Math.sqrt(s / a.length + 1e-7)
    const x = a.map((v) => (v - m) / sd)
    const o = await sess.run({ input_values: new ort.Tensor('float32', x, [1, x.length]) })
    const T = o.logits.dims[1]
    const lp = prepare(o.logits.data, T, V)
    const sc = calibrate(calib, Array.from(afGop(lp, T, V, seq, phoneIds)), seq)
    const tails = tailLLR(lp, T, V, seq, tp.map((t) => t.at), VOWELS.map((p) => vocab[p]))
    const flags = tails.map((t, i) => (t.ins > calib.utt.insTh ? `${tp[i].word.word}:加尾音` : t.del > calib.utt.delTh ? `${tp[i].word.word}:漏尾音` : null)).filter(Boolean)
    const red = phones.filter((p, k) => sc[k] < calib.thresholds.red).length
    console.log(JSON.stringify({ accent, score: Math.round(uttScore(calib, sc, tails, words.length, T) * 10), red, yellow: phones.filter((p, k) => sc[k] >= calib.thresholds.red && sc[k] < calib.thresholds.yellow), flags, text: item.text }))
  }
}
