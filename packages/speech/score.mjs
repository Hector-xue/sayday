// 整句打分（网页 / 安卓 App / 给 AI 助手的 MCP 工具共用）：音素后验 → 逐音素校准分 + 尾音检查 + 整句分
// assets = { dict: CMUdict（词 → 音素串）, vocab: 音素 → 模型输出下标, calib: calib.json, phoneIds: 可替换的音素下标 }
import { prepare, afGop, tailLLR } from './gop.mjs'
import { calibrate, tailNote, tailPositions, uttScore, VOWELS } from './calib.mjs'

export const phoneIdsOf = (vocab) => Object.entries(vocab).filter(([k]) => !k.startsWith('[')).map(([, id]) => id)

// café → cafe：先去掉重音符号再切词，否则会切成 caf
export const tokenize = (text) => (text.normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).map((w) => w.toLowerCase())

/** 英式拼写 → CMUdict（美式）里能查到的写法：practise/practising、colour、centre、travelled… */
// 常见英式词：拼法规则推不出来的直接对照
const UK = { maths: 'math', programme: 'program', programmes: 'programs', grey: 'gray', tyre: 'tire', tyres: 'tires', aeroplane: 'airplane', cheque: 'check', pyjamas: 'pajamas', aluminium: 'aluminum', jewellery: 'jewelry', plough: 'plow', sceptical: 'skeptical' }

export function dictWord(dict, w) {
  if (dict[w]) return w
  if (UK[w] && dict[UK[w]]) return UK[w]
  const tries = [
    w.replace(/is(e|es|ed|ing|ation|ations)$/, 'iz$1'), w.replace(/^practis/, 'practic'), w.replace(/our(s|ed|ing|ite|ful)?$/, 'or$1'),
    w.replace(/tre(s)?$/, 'ter$1'), w.replace(/ll(ed|ing|er)$/, 'l$1'), w.replace(/yse(s|d)?$/, 'yze$1'), w.replace(/ogue$/, 'og'), w.replace(/ence$/, 'ense'),
  ]
  return tries.find((t) => t !== w && dict[t]) ?? null
}

/** 录音送进模型前的归一化（均值 0、方差 1），网页、App、服务端一致 */
export function normalize(a) {
  let m = 0
  for (const x of a) m += x
  m /= a.length
  let v = 0
  for (const x of a) v += (x - m) ** 2
  const sd = Math.sqrt(v / a.length + 1e-7)
  return Float32Array.from(a, (x) => (x - m) / sd)
}

/** r = { logits: Float32Array(T×V), T, V } */
export function scoreWith(assets, text, r) {
  const { dict, vocab, calib, phoneIds } = assets
  const all = tokenize(text)
  const known = all.filter((w) => dictWord(dict, w)).map((w) => ({ word: w, phones: dict[dictWord(dict, w)].split(' ') }))
  const skipped = all.filter((w) => !dictWord(dict, w))
  const seq = known.flatMap((w) => w.phones).map((p) => vocab[p])
  const lp = prepare(r.logits, r.T, r.V)
  const scores = calibrate(calib, Array.from(afGop(lp, r.T, r.V, seq, phoneIds)), seq)
  const tp = tailPositions(known)
  const tails = tailLLR(lp, r.T, r.V, seq, tp.map((t) => t.at), VOWELS.map((p) => vocab[p]))
  const { red, yellow } = calib.thresholds
  const lv = (g) => (g < red ? 'r' : g < yellow ? 'y' : 'g')
  const tailOf = new Map()
  tails.forEach((t, i) => tailOf.set(tp[i].word, tailNote(calib, t, tp[i], known)))
  let k = 0
  const words = known.map((w) => {
    const phones = w.phones.map((p) => { const s = scores[k++]; return { p, s, level: lv(s) } })
    const tail = tailOf.get(w) ?? null
    const worst = phones.some((x) => x.level === 'r') ? 'r' : phones.some((x) => x.level === 'y') || tail === 'ins' ? 'y' : 'g'
    return { word: w.word, phones, tail, level: worst }
  })
  return { score: Math.round(uttScore(calib, scores, tails, known.length, r.T) * 10), words, skipped, T: r.T }
}
