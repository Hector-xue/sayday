// 临时：中国学习者录音上比较离线识别模型（WER / 速度）
import { pipeline } from '@huggingface/transformers'
import { readFileSync } from 'node:fs'
const [dir, model, dtype] = process.argv.slice(2)
const meta = JSON.parse(readFileSync(`${dir}/meta.json`))
const norm = (t) => t.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean)
function wer(ref, hyp) {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)])
  for (let j = 1; j <= hyp.length; j++) d[0][j] = j
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1))
  return d[ref.length][hyp.length]
}
const t0 = Date.now()
const asr = await pipeline('automatic-speech-recognition', model, { dtype, device: 'cpu' })
console.log('load', Date.now() - t0, 'ms')
let E = 0, N = 0, ms = 0, sec = 0
const byBand = {}
for (const m of meta) {
  const x = new Float32Array(readFileSync(`${dir}/${m.id}.f32`).buffer.slice(0))
  const t = Date.now()
  const out = await asr(x)
  ms += Date.now() - t; sec += m.sec
  const r = norm(m.text), h = norm(out.text)
  const e = wer(r, h)
  E += e; N += r.length
  const b = m.total < 5 ? '0-4' : m.total < 7 ? '5-6' : m.total < 9 ? '7-8' : '9-10'
  ;(byBand[b] ??= [0, 0]); byBand[b][0] += e; byBand[b][1] += r.length
  if (Math.random() < 0.05) console.log(m.total, '|', m.text, '|', out.text)
}
console.log(model, dtype, 'WER', (E / N).toFixed(3), 'RTF', (ms / 1000 / sec).toFixed(3), Object.fromEntries(Object.entries(byBand).map(([k, [e, n]]) => [k, (e / n).toFixed(3)])))
