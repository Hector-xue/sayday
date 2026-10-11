// 校准模型（梯度提升树）推理：GOP 特征 → 0~2 分（贴近人工打分刻度）
// x = [af, 句内 af 均值, ...音素 one-hot(42)]
export function predict(model, x) {
  let y = model.baseline
  for (const nodes of model.trees) {
    let i = 0
    for (;;) {
      const [leaf, f, thr, missLeft, l, r, v] = nodes[i]
      if (leaf) { y += v; break }
      const xv = x[f]
      i = Number.isNaN(xv) ? (missLeft ? l : r) : xv <= thr ? l : r
    }
  }
  return y
}

/** 整句：gop 数组 + 音素 id 序列 → 每个音素的校准分 */
export function calibrate(model, gop, seq, V = 42) {
  const af = gop.map((g) => Math.max(-20, Math.min(0, g)))
  const mean = af.reduce((a, b) => a + b, 0) / af.length
  return af.map((a, k) => {
    const x = new Array(2 + V).fill(0)
    x[0] = a
    x[1] = mean
    x[2 + seq[k]] = 1
    return predict(model, x)
  })
}

export const VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']

/** 以辅音结尾的词，其最后一个音素在整句音素序列里的下标 */
export function tailPositions(words) {
  const pos = []
  let k = 0
  for (const w of words) {
    k += w.phones.length
    if (!VOWELS.includes(w.phones[w.phones.length - 1])) pos.push({ word: w, at: k - 1 })
  }
  return pos
}

/**
 * 整句分（0~10，贴近人工句子准确度刻度）。
 * scores：逐音素校准分；tails：tailLLR 结果；T：帧数
 */
export function uttScore(model, scores, tails, nWords, T) {
  const u = model.utt
  const n = scores.length
  const ins = tails.map((t) => t.ins)
  const x = [
    scores.reduce((a, b) => a + b, 0) / n,
    Math.min(...scores),
    scores.filter((s) => s < 1.4).length / n,
    ins.filter((v) => v > u.insTh).length / nWords,
    tails.filter((t) => t.del > u.delTh).length / nWords,
    ins.length ? ins.reduce((a, v) => a + Math.max(0, v), 0) / ins.length : 0,
    T / n,
  ]
  const y = x.reduce((a, v, i) => a + v * u.coef[i], u.intercept)
  return Math.max(0, Math.min(10, y))
}
