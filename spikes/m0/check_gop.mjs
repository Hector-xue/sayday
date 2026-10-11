// 校验 JS 版 GOP 与 Python 参考一致，并测耗时：node check_gop.mjs
import { readFileSync } from 'node:fs'
import { prepare, afGop } from './web/gop.mjs'

const dir = new URL('./web/samples/', import.meta.url)
const meta = JSON.parse(readFileSync(new URL('meta.json', dir)))
const ref = JSON.parse(readFileSync(new URL('gop_ref.json', dir)))
for (const m of meta) {
  const buf = readFileSync(new URL(`u${m.i}.ref.f32`, dir))
  const logits = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const r = ref.items[m.i]
  const t0 = performance.now()
  const lp = prepare(logits, m.frames, m.vocab)
  const g = afGop(lp, m.frames, m.vocab, r.seq, ref.phoneIds)
  const ms = performance.now() - t0
  const maxDiff = Math.max(...Array.from(g, (x, k) => Math.abs(x - r.af[k])))
  console.log(JSON.stringify({ text: m.text, phones: r.seq.length, frames: m.frames, ms: Math.round(ms), maxDiffVsPython: +maxDiff.toExponential(2), worst: r.phones.map((p, k) => [p, +g[k].toFixed(2)]).sort((a, b) => a[1] - b[1]).slice(0, 3) }))
}
